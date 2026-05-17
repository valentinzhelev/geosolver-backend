/**
 * Derive a simple status key for student assignment list UI.
 */
function getStudentAssignmentStatus(assignment, submissions) {
  const maxAttempts = assignment.options?.maxAttempts ?? 3;
  const attemptsUsed = submissions.length;
  const latest = submissions.length
    ? [...submissions].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))[0]
    : null;

  const now = new Date();
  const due = new Date(assignment.dueDate);
  const canSubmitLate = assignment.options?.allowLateSubmissions !== false;
  const isOpen =
    assignment.status === 'active' && (now <= due || (now > due && canSubmitLate));

  if (latest) {
    if (latest.status === 'graded' || latest.status === 'returned') {
      return latest.isLate ? 'graded_late' : 'graded';
    }
    if (latest.status === 'needs_review') {
      return latest.isLate ? 'submitted_late' : 'awaiting_review';
    }
    return latest.isLate ? 'submitted_late' : 'submitted';
  }

  if (!isOpen && now > due && !canSubmitLate) {
    return 'closed';
  }
  if (attemptsUsed >= maxAttempts) {
    return 'attempts_exhausted';
  }
  if (now > due && canSubmitLate) {
    return 'late_pending';
  }
  return 'pending';
}

module.exports = { getStudentAssignmentStatus };
