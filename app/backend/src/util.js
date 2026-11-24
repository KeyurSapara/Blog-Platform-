// Forwards errors from async route handlers to Express's error middleware.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const toId = (value) => {
  const id = parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

module.exports = { asyncHandler, toId };
