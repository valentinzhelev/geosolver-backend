const VALID_POLICIES = ['off', 'guided', 'full'];

function normalizeCalculatorPolicy(value) {
  if (VALID_POLICIES.includes(value)) return value;
  return 'guided';
}

function allowsCalculator(policy) {
  const p = normalizeCalculatorPolicy(policy);
  return p === 'guided' || p === 'full';
}

function allowsSaveToAssignment(policy) {
  return allowsCalculator(policy);
}

module.exports = {
  VALID_POLICIES,
  normalizeCalculatorPolicy,
  allowsCalculator,
  allowsSaveToAssignment,
};
