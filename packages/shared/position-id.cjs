const POSITION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_POSITION_ID_LENGTH = 64;

function isPositionId(value) {
  return (
    typeof value === "string" &&
    value.length <= MAX_POSITION_ID_LENGTH &&
    POSITION_ID_PATTERN.test(value)
  );
}

module.exports = {
  MAX_POSITION_ID_LENGTH,
  POSITION_ID_PATTERN,
  isPositionId,
};
