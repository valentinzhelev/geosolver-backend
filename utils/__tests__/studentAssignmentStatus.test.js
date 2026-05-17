const { getStudentAssignmentStatus } = require('../studentAssignmentStatus');

describe('getStudentAssignmentStatus', () => {
  const baseAssignment = {
    status: 'active',
    dueDate: new Date(Date.now() + 86400000),
    options: { maxAttempts: 3, allowLateSubmissions: true },
  };

  test('pending when no submissions and open', () => {
    expect(getStudentAssignmentStatus(baseAssignment, [])).toBe('pending');
  });

  test('graded when latest is graded', () => {
    const subs = [{ status: 'graded', isLate: false, submittedAt: new Date() }];
    expect(getStudentAssignmentStatus(baseAssignment, subs)).toBe('graded');
  });

  test('attempts_exhausted when max attempts reached', () => {
    const subs = [
      { status: 'submitted', submittedAt: new Date() },
      { status: 'submitted', submittedAt: new Date() },
      { status: 'submitted', submittedAt: new Date() },
    ];
    expect(getStudentAssignmentStatus(baseAssignment, subs)).toBe('submitted');
  });

  test('closed when past due and late not allowed', () => {
    const past = {
      ...baseAssignment,
      dueDate: new Date(Date.now() - 86400000),
      options: { maxAttempts: 3, allowLateSubmissions: false },
    };
    expect(getStudentAssignmentStatus(past, [])).toBe('closed');
  });
});
