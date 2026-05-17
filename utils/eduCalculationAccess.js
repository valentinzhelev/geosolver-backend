const Assignment = require('../models/Assignment');
const Course = require('../models/Course');
const { includesId } = require('./objectId');
const { normalizeCalculatorPolicy, allowsCalculator } = require('./eduCalculatorPolicy');

async function validateEduCalculationAccess(userId, assignmentId) {
  if (!userId || !assignmentId) {
    const err = new Error('Липсва контекст на задание');
    err.status = 400;
    throw err;
  }

  const assignment = await Assignment.findById(assignmentId);
  if (!assignment) {
    const err = new Error('Заданието не е намерено');
    err.status = 404;
    throw err;
  }

  const course = await Course.findById(assignment.course);
  if (!course) {
    const err = new Error('Групата не е намерена');
    err.status = 404;
    throw err;
  }

  if (!includesId(course.students, userId)) {
    const err = new Error('Нямате достъп до това задание');
    err.status = 403;
    throw err;
  }

  const policy = normalizeCalculatorPolicy(assignment.options?.calculatorPolicy);
  if (!allowsCalculator(policy)) {
    const err = new Error('За това задание калкулаторът не е разрешен от преподавателя');
    err.status = 403;
    throw err;
  }

  return { assignment, policy };
}

module.exports = { validateEduCalculationAccess };
