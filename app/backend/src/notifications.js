const {
  SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
  SetSubscriptionAttributesCommand,
  GetSubscriptionAttributesCommand,
  ListSubscriptionsByTopicCommand,
  PublishCommand,
} = require("@aws-sdk/client-sns");
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");

// One SNS topic carries every "new post" event, tagged with an author_id message attribute.
// Each reader has ONE email subscription on that topic whose filter policy lists the
// authors they follow, so SNS fans a post out only to that author's subscribers.
// SES sends the one-off emails (subscription welcome, "you have a new subscriber").
const MAX_FILTER_VALUES = 100; // SNS allows 150 values per filter policy

const filterPolicy = (authorIds) => JSON.stringify({ author_id: [...new Set(authorIds)].sort() });

// SNS subjects: max 100 chars, no line breaks or control characters.
const subjectLine = (text) => text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 100);

function createNotifications({ sns, ses, topicArn, senderEmail, blogUrl }) {
  const enabled = Boolean(topicArn);

  async function findSubscriptionArn(email) {
    let NextToken;
    do {
      const page = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn, NextToken }));
      const match = (page.Subscriptions || []).find((s) => s.Protocol === "email" && s.Endpoint === email);
      if (match) return match.SubscriptionArn;
      NextToken = page.NextToken;
    } while (NextToken);
    return null;
  }

  async function setFilter(arn, authorIds) {
    await sns.send(
      new SetSubscriptionAttributesCommand({
        SubscriptionArn: arn,
        AttributeName: "FilterPolicy",
        AttributeValue: filterPolicy(authorIds),
      })
    );
    return arn;
  }

  // Makes the reader's SNS email subscription match the authors they follow.
  // Returns the subscription ARN to store, or null when they follow nobody.
  async function syncEmailSubscription(email, authorIds, currentArn) {
    if (!enabled) return null;
    if (authorIds.length > MAX_FILTER_VALUES) throw new Error(`Cannot follow more than ${MAX_FILTER_VALUES} authors`);

    if (!authorIds.length) {
      if (currentArn) {
        await sns.send(new UnsubscribeCommand({ SubscriptionArn: currentArn })).catch((err) => {
          console.warn("SNS unsubscribe failed (already removed?):", err.message);
        });
      }
      return null;
    }

    if (currentArn) {
      try {
        return await setFilter(currentArn, authorIds);
      } catch (err) {
        // e.g. the reader clicked "unsubscribe" in an SNS email, so the ARN is gone.
        console.warn("SNS filter update failed, subscribing again:", err.message);
      }
    }

    try {
      // The first Subscribe makes SNS send an "AWS Notification - Subscription Confirmation" email.
      const res = await sns.send(
        new SubscribeCommand({
          TopicArn: topicArn,
          Protocol: "email",
          Endpoint: email,
          ReturnSubscriptionArn: true,
          Attributes: { FilterPolicy: filterPolicy(authorIds) },
        })
      );
      return res.SubscriptionArn;
    } catch (err) {
      // The email is already subscribed with an older filter policy we lost track of.
      if (err.name !== "InvalidParameterException") throw err;
      const existing = await findSubscriptionArn(email);
      if (!existing) throw err;
      return setFilter(existing, authorIds);
    }
  }

  async function isEmailConfirmed(arn) {
    if (!enabled || !arn) return false;
    try {
      const res = await sns.send(new GetSubscriptionAttributesCommand({ SubscriptionArn: arn }));
      return res.Attributes?.PendingConfirmation === "false";
    } catch {
      return false;
    }
  }

  async function notifyNewPost({ id, authorId, authorName, title, content }) {
    if (!enabled) return;
    const excerpt = content.length > 500 ? `${content.slice(0, 500)}…` : content;
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: subjectLine(`New post from ${authorName}: ${title}`),
        Message: `${authorName} just published "${title}" on CloudBlog.\n\n${excerpt}\n\nRead it here: ${blogUrl}/#/post/${id}\n`,
        MessageAttributes: { author_id: { DataType: "String", StringValue: authorId } },
      })
    );
  }

  // SES in sandbox mode only delivers to verified addresses, so failures are logged, not thrown.
  async function sendEmail(to, subject, text) {
    if (!senderEmail || !to) return;
    try {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: senderEmail,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
        })
      );
    } catch (err) {
      console.warn(`SES email to ${to} failed:`, err.message);
    }
  }

  async function notifySubscribed({ subscriber, author, subscriberCount, emailConfirmed }) {
    const confirmHint = enabled && !emailConfirmed
      ? "\nTo receive new-post alerts, open the email from \"AWS Notifications\" and click \"Confirm subscription\".\n"
      : "";
    await Promise.all([
      sendEmail(
        subscriber.email,
        `You're subscribed to ${author.name} on CloudBlog`,
        `Hi ${subscriber.name},\n\nYou will now get an email whenever ${author.name} publishes a new post.\n${confirmHint}\nManage your subscriptions: ${blogUrl}/#/profile\n`
      ),
      sendEmail(
        author.email,
        `${subscriber.name} subscribed to your CloudBlog posts`,
        `Hi ${author.name},\n\n${subscriber.name} just subscribed to your posts. You now have ${subscriberCount} subscriber(s).\n\nWrite something new: ${blogUrl}/#/new\n`
      ),
    ]);
  }

  return { enabled, syncEmailSubscription, isEmailConfirmed, notifyNewPost, notifySubscribed, sendEmail };
}

// Shared instance built from the .env settings (kept separate so tests can inject fakes).
let shared;
function fromConfig() {
  if (shared) return shared;
  const { aws, blogUrl } = require("./config");
  shared = createNotifications({
    sns: new SNSClient({ region: aws.region }),
    ses: new SESv2Client({ region: aws.region }),
    topicArn: aws.snsTopicArn,
    senderEmail: aws.sesSenderEmail,
    blogUrl,
  });
  return shared;
}

module.exports = { createNotifications, fromConfig, filterPolicy, MAX_FILTER_VALUES };
