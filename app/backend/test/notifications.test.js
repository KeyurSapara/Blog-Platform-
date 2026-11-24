// Unit tests for the SNS/SES notification logic, using in-memory fake AWS clients.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createNotifications, filterPolicy } = require("../src/notifications");

const TOPIC = "arn:aws:sns:us-east-1:123456789012:blogec2-author-posts";

// Records every command sent and answers from `handlers` keyed by command class name.
function fakeClient(handlers = {}) {
  const calls = [];
  return {
    calls,
    async send(cmd) {
      const name = cmd.constructor.name;
      calls.push({ name, input: cmd.input });
      const handler = handlers[name];
      return handler ? handler(cmd.input) : {};
    },
  };
}

const setup = (snsHandlers, opts = {}) => {
  const sns = fakeClient(snsHandlers);
  const ses = fakeClient();
  const n = createNotifications({
    sns,
    ses,
    topicArn: TOPIC,
    senderEmail: "noreply@example.com",
    blogUrl: "https://blog.example.com",
    ...opts,
  });
  return { n, sns, ses };
};

test("filter policy lists each author once, sorted", () => {
  assert.equal(filterPolicy(["b", "a", "b"]), '{"author_id":["a","b"]}');
});

test("first subscription creates an SNS email subscription with a filter policy", async () => {
  const { n, sns } = setup({ SubscribeCommand: () => ({ SubscriptionArn: `${TOPIC}:sub-1` }) });
  const arn = await n.syncEmailSubscription("reader@example.com", ["author-1"], null);

  assert.equal(arn, `${TOPIC}:sub-1`);
  assert.deepEqual(sns.calls[0], {
    name: "SubscribeCommand",
    input: {
      TopicArn: TOPIC,
      Protocol: "email",
      Endpoint: "reader@example.com",
      ReturnSubscriptionArn: true,
      Attributes: { FilterPolicy: '{"author_id":["author-1"]}' },
    },
  });
});

test("following another author updates the existing filter policy instead of re-subscribing", async () => {
  const { n, sns } = setup();
  const arn = await n.syncEmailSubscription("reader@example.com", ["a1", "a2"], `${TOPIC}:sub-1`);

  assert.equal(arn, `${TOPIC}:sub-1`);
  assert.equal(sns.calls.length, 1);
  assert.equal(sns.calls[0].name, "SetSubscriptionAttributesCommand");
  assert.equal(sns.calls[0].input.AttributeValue, '{"author_id":["a1","a2"]}');
});

test("a deleted SNS subscription is recreated", async () => {
  const { n, sns } = setup({
    SetSubscriptionAttributesCommand: () => {
      throw Object.assign(new Error("Subscription does not exist"), { name: "NotFoundException" });
    },
    SubscribeCommand: () => ({ SubscriptionArn: `${TOPIC}:sub-2` }),
  });
  const arn = await n.syncEmailSubscription("reader@example.com", ["a1"], `${TOPIC}:sub-1`);

  assert.equal(arn, `${TOPIC}:sub-2`);
  assert.deepEqual(sns.calls.map((c) => c.name), ["SetSubscriptionAttributesCommand", "SubscribeCommand"]);
});

test("an untracked existing subscription is found and updated", async () => {
  const { n, sns } = setup({
    SubscribeCommand: () => {
      throw Object.assign(new Error("Subscription already exists with different attributes"), {
        name: "InvalidParameterException",
      });
    },
    ListSubscriptionsByTopicCommand: () => ({
      Subscriptions: [{ Protocol: "email", Endpoint: "reader@example.com", SubscriptionArn: `${TOPIC}:old` }],
    }),
  });
  const arn = await n.syncEmailSubscription("reader@example.com", ["a1"], null);

  assert.equal(arn, `${TOPIC}:old`);
  assert.equal(sns.calls.at(-1).name, "SetSubscriptionAttributesCommand");
});

test("following nobody removes the SNS subscription", async () => {
  const { n, sns } = setup();
  const arn = await n.syncEmailSubscription("reader@example.com", [], `${TOPIC}:sub-1`);

  assert.equal(arn, null);
  assert.deepEqual(sns.calls, [{ name: "UnsubscribeCommand", input: { SubscriptionArn: `${TOPIC}:sub-1` } }]);
});

test("new posts are published with the author_id attribute used by the filter", async () => {
  const { n, sns } = setup();
  await n.notifyNewPost({ id: 7, authorId: "a1", authorName: "alice", title: "Hello\nworld", content: "Body" });

  const { input } = sns.calls[0];
  assert.equal(input.TopicArn, TOPIC);
  assert.equal(input.Subject, "New post from alice: Hello world");
  assert.deepEqual(input.MessageAttributes, { author_id: { DataType: "String", StringValue: "a1" } });
  assert.match(input.Message, /https:\/\/blog\.example\.com\/#\/post\/7/);
});

test("subscribing emails both the reader and the author through SES", async () => {
  const { n, ses } = setup();
  await n.notifySubscribed({
    subscriber: { name: "bob", email: "bob@example.com" },
    author: { name: "alice", email: "alice@example.com" },
    subscriberCount: 3,
    emailConfirmed: false,
  });

  const to = ses.calls.map((c) => c.input.Destination.ToAddresses[0]).sort();
  assert.deepEqual(to, ["alice@example.com", "bob@example.com"]);
  const authorMail = ses.calls.find((c) => c.input.Destination.ToAddresses[0] === "alice@example.com");
  assert.match(authorMail.input.Content.Simple.Body.Text.Data, /bob just subscribed.*3 subscriber/);
});

test("SES failures (e.g. sandbox, unverified address) do not throw", async () => {
  const sns = fakeClient();
  const ses = fakeClient({
    SendEmailCommand: () => {
      throw new Error("Email address is not verified");
    },
  });
  const n = createNotifications({ sns, ses, topicArn: TOPIC, senderEmail: "noreply@example.com", blogUrl: "" });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.doesNotReject(n.sendEmail("x@example.com", "s", "t"));
  } finally {
    console.warn = warn;
  }
});

test("everything is a no-op when SNS and SES are not configured", async () => {
  const { n, sns, ses } = setup({}, { topicArn: "", senderEmail: "" });
  assert.equal(n.enabled, false);
  assert.equal(await n.syncEmailSubscription("r@example.com", ["a1"], null), null);
  await n.notifyNewPost({ id: 1, authorId: "a1", authorName: "a", title: "t", content: "c" });
  await n.sendEmail("r@example.com", "s", "t");
  assert.equal(sns.calls.length + ses.calls.length, 0);
});
