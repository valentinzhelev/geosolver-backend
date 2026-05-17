const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');
const { createNotification } = require('./notifications');

const MS_DAY = 24 * 60 * 60 * 1000;
let started = false;

async function runDueSoonCheck() {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + MS_DAY);

    const assignments = await Assignment.find({
      status: 'active',
      dueDate: { $gt: now, $lte: in24h },
    }).select('title dueDate course');

    for (const assignment of assignments) {
      const course = await Course.findById(assignment.course).select('students');
      if (!course?.students?.length) continue;

      for (const studentId of course.students) {
        const submitted = await Submission.findOne({
          assignment: assignment._id,
          student: studentId,
        });
        if (submitted) continue;

        await createNotification({
          userId: studentId,
          type: 'assignment_due_soon',
          title: `Краен срок утре: ${assignment.title}`,
          body: `Предайте до ${new Date(assignment.dueDate).toLocaleString('bg-BG')}`,
          link: `/classroom/assignments/${assignment._id}`,
          meta: { assignmentId: assignment._id, dedupeKey: `due-${assignment._id}-${studentId}` },
        });
      }
    }
  } catch (err) {
    console.warn('Due-soon scheduler error:', err.message);
  }
}

function startDueSoonScheduler() {
  if (started) return;
  started = true;
  const sixHours = 6 * 60 * 60 * 1000;
  setTimeout(runDueSoonCheck, 15000);
  setInterval(runDueSoonCheck, sixHours);
}

module.exports = { startDueSoonScheduler, runDueSoonCheck };
