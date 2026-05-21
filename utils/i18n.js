/**
 * API message localization (bg / en).
 * Prefer message keys via msg(); translateMessage() supports legacy Bulgarian strings.
 */

const MESSAGES = {
  ALL_FIELDS_REQUIRED: {
    bg: 'Всички полета са задължителни.',
    en: 'All fields are required.',
  },
  EMAIL_ALREADY_REGISTERED: {
    bg: 'Имейлът вече е регистриран.',
    en: 'This email is already registered.',
  },
  REGISTER_ERROR: {
    bg: 'Грешка при регистрация.',
    en: 'Registration failed.',
  },
  INVALID_CREDENTIALS: {
    bg: 'Грешен имейл или парола.',
    en: 'Invalid email or password.',
  },
  LOGIN_ERROR: {
    bg: 'Грешка при вход.',
    en: 'Login failed.',
  },
  USER_NOT_FOUND: {
    bg: 'Потребителят не е намерен.',
    en: 'User not found.',
  },
  ACCOUNT_LOAD_ERROR: {
    bg: 'Грешка при зареждане на акаунта.',
    en: 'Failed to load account.',
  },
  ADMIN_ONLY: {
    bg: 'Това е достъпно само за администратори.',
    en: 'This is only available to administrators.',
  },
  REFRESH_TOKEN_MISSING: {
    bg: 'Липсва refresh token.',
    en: 'Refresh token is missing.',
  },
  REFRESH_TOKEN_INVALID: {
    bg: 'Невалиден refresh token.',
    en: 'Invalid refresh token.',
  },
  REFRESH_ERROR: {
    bg: 'Грешка при опресняване на токена.',
    en: 'Failed to refresh token.',
  },
  LOGOUT_SUCCESS: {
    bg: 'Успешно излизане.',
    en: 'Logged out successfully.',
  },
  LOGOUT_ERROR: {
    bg: 'Грешка при излизане.',
    en: 'Logout failed.',
  },
  OLD_PASSWORD_WRONG: {
    bg: 'Грешна стара парола.',
    en: 'Current password is incorrect.',
  },
  PASSWORD_CHANGED_RELOGIN: {
    bg: 'Паролата е сменена успешно. Моля, влезте отново.',
    en: 'Password changed successfully. Please sign in again.',
  },
  PASSWORD_CHANGE_ERROR: {
    bg: 'Грешка при смяна на паролата.',
    en: 'Failed to change password.',
  },
  VERIFICATION_TOKEN_MISSING: {
    bg: 'Липсва verification token.',
    en: 'Verification token is missing.',
  },
  VERIFICATION_TOKEN_INVALID: {
    bg: 'Невалиден verification token.',
    en: 'Invalid verification token.',
  },
  EMAIL_VERIFIED: {
    bg: 'Имейлът е успешно верифициран.',
    en: 'Email verified successfully.',
  },
  VERIFICATION_ERROR: {
    bg: 'Грешка при верификация.',
    en: 'Verification failed.',
  },
  EMAIL_MISSING: {
    bg: 'Липсва имейл.',
    en: 'Email is required.',
  },
  RESET_EMAIL_SENT: {
    bg: 'Ако имейлът съществува, ще получите инструкции.',
    en: 'If the email exists, you will receive instructions.',
  },
  RESET_EMAIL_SENT_FULL: {
    bg: 'Ако имейлът съществува, ще получите инструкции за възстановяване.',
    en: 'If the email exists, you will receive reset instructions.',
  },
  FORGOT_PASSWORD_ERROR: {
    bg: 'Грешка при заявка за нова парола.',
    en: 'Password reset request failed.',
  },
  RESET_TOKEN_OR_PASSWORD_MISSING: {
    bg: 'Липсва токен или нова парола.',
    en: 'Token or new password is missing.',
  },
  RESET_TOKEN_INVALID: {
    bg: 'Невалиден или изтекъл токен.',
    en: 'Invalid or expired token.',
  },
  PASSWORD_RESET_SUCCESS: {
    bg: 'Паролата е сменена успешно. Моля, влезте с новата парола.',
    en: 'Password changed successfully. Please sign in with your new password.',
  },
  TOKEN_MISSING: {
    bg: 'Липсва токен.',
    en: 'Authentication token is missing.',
  },
  TOKEN_INVALID: {
    bg: 'Невалиден токен.',
    en: 'Invalid authentication token.',
  },
  ACCESS_DENIED: {
    bg: 'Нямате достъп.',
    en: 'Access denied.',
  },
  ACCESS_DENIED_FEATURE: {
    bg: 'Нямате достъп до тази функция.',
    en: 'You do not have access to this feature.',
  },
  NO_PERMISSION: {
    bg: 'Нямате права',
    en: 'You do not have permission.',
  },
  NO_PERMISSION_DOT: {
    bg: 'Нямате права.',
    en: 'You do not have permission.',
  },
  CONTACT_UNAVAILABLE: {
    bg: 'Контактната форма временно не е налична. Моля, пишете на help@geosolver.bg.',
    en: 'The contact form is temporarily unavailable. Please email help@geosolver.bg.',
  },
  CONTACT_SENT: {
    bg: 'Съобщението е изпратено успешно!',
    en: 'Your message was sent successfully!',
  },
  CONTACT_SEND_ERROR: {
    bg: 'Грешка при изпращане на съобщението.',
    en: 'Failed to send your message.',
  },
  LOAD_ASSIGNMENTS_ERROR: {
    bg: 'Грешка при зареждане на заданията',
    en: 'Failed to load assignments',
  },
  LOAD_QUEUE_ERROR: {
    bg: 'Грешка при зареждане на опашката',
    en: 'Failed to load review queue',
  },
  INVALID_STATUS: {
    bg: 'Невалиден статус',
    en: 'Invalid status',
  },
  ASSIGNMENT_NOT_FOUND: {
    bg: 'Заданието не е намерено',
    en: 'Assignment not found',
  },
  ASSIGNMENT_NOT_FOUND_DOT: {
    bg: 'Заданието не е намерено.',
    en: 'Assignment not found.',
  },
  NO_ACCESS_ASSIGNMENT: {
    bg: 'Нямате достъп до това задание',
    en: 'You do not have access to this assignment',
  },
  VARIANTS_GENERATION_FAILED: {
    bg: 'Неуспешно генериране на варианти при публикуване',
    en: 'Failed to generate variants when publishing',
  },
  STATUS_CHANGE_ERROR: {
    bg: 'Грешка при промяна на статуса',
    en: 'Failed to change status',
  },
  LOAD_ASSIGNMENT_ERROR: {
    bg: 'Грешка при зареждане на заданието',
    en: 'Failed to load assignment',
  },
  INVALID_ASSIGNMENT_TOOL: {
    bg: 'Невалиден инструмент за задание',
    en: 'Invalid assignment tool',
  },
  REQUIRED_FIELDS_MISSING: {
    bg: 'Липсват задължителни полета',
    en: 'Required fields are missing',
  },
  COURSE_NOT_FOUND: {
    bg: 'Курсът не е намерен',
    en: 'Course not found',
  },
  NO_RIGHTS_CREATE_ASSIGNMENT: {
    bg: 'Нямате права да създавате задания за този курс',
    en: 'You cannot create assignments for this course',
  },
  TASK_TEMPLATE_NOT_FOUND: {
    bg: 'Шаблонът за задача не е намерен',
    en: 'Task template not found',
  },
  VARIANTS_GENERATION_ERROR: {
    bg: 'Грешка при генериране на вариантите',
    en: 'Failed to generate variants',
  },
  ASSIGNMENT_CREATED: {
    bg: 'Заданието е създадено успешно',
    en: 'Assignment created successfully',
  },
  ASSIGNMENT_CREATE_ERROR: {
    bg: 'Грешка при създаване на заданието',
    en: 'Failed to create assignment',
  },
  NO_RIGHTS_EDIT_ASSIGNMENT: {
    bg: 'Нямате права да редактирате това задание',
    en: 'You cannot edit this assignment',
  },
  ASSIGNMENT_UPDATED: {
    bg: 'Заданието е обновено успешно',
    en: 'Assignment updated successfully',
  },
  ASSIGNMENT_UPDATE_ERROR: {
    bg: 'Грешка при обновяване на заданието',
    en: 'Failed to update assignment',
  },
  GAI_ANALYSIS_ERROR: {
    bg: 'Грешка при GAI анализ',
    en: 'GAI analysis failed',
  },
  NO_RIGHTS_VIEW_SUBMISSIONS: {
    bg: 'Нямате права да видите submissions за това задание',
    en: 'You cannot view submissions for this assignment',
  },
  LOAD_SUBMISSIONS_ERROR: {
    bg: 'Грешка при зареждане на submissions',
    en: 'Failed to load submissions',
  },
  GRADE_RANGE: {
    bg: 'Оценката трябва да бъде между 0 и 100',
    en: 'Grade must be between 0 and 100',
  },
  SUBMISSION_NOT_FOUND: {
    bg: 'Submission не е намерен',
    en: 'Submission not found',
  },
  NO_RIGHTS_GRADE_SUBMISSION: {
    bg: 'Нямате права да оценявате този submission',
    en: 'You cannot grade this submission',
  },
  SUBMISSION_GRADED: {
    bg: 'Submission е оценен успешно',
    en: 'Submission graded successfully',
  },
  GRADE_SUBMISSION_ERROR: {
    bg: 'Грешка при оценяване на submission',
    en: 'Failed to grade submission',
  },
  ASSIGNMENT_PUBLISHED: {
    bg: 'Заданието е публикувано',
    en: 'Assignment published',
  },
  PUBLISH_ERROR: {
    bg: 'Грешка при публикуване',
    en: 'Failed to publish',
  },
  DRAFT_COPY_CREATED: {
    bg: 'Черновата копие е създадена',
    en: 'Draft copy created',
  },
  DUPLICATE_ERROR: {
    bg: 'Грешка при дублиране',
    en: 'Failed to duplicate',
  },
  EXPORT_ERROR: {
    bg: 'Грешка при експорт',
    en: 'Export failed',
  },
  NO_RIGHTS_DELETE_ASSIGNMENT: {
    bg: 'Нямате права да изтриете това задание',
    en: 'You cannot delete this assignment',
  },
  ASSIGNMENT_DELETED: {
    bg: 'Заданието е изтрито успешно',
    en: 'Assignment deleted successfully',
  },
  ASSIGNMENT_DELETE_ERROR: {
    bg: 'Грешка при изтриване на заданието',
    en: 'Failed to delete assignment',
  },
  LOAD_COURSES_ERROR: {
    bg: 'Грешка при зареждане на курсовете',
    en: 'Failed to load courses',
  },
  NO_ACCESS_COURSE: {
    bg: 'Нямате достъп до този курс',
    en: 'You do not have access to this course',
  },
  LOAD_COURSE_ERROR: {
    bg: 'Грешка при зареждане на курса',
    en: 'Failed to load course',
  },
  COURSE_NAME_CODE_REQUIRED: {
    bg: 'Името и кодът на курса са задължителни',
    en: 'Course name and code are required',
  },
  COURSE_CODE_EXISTS: {
    bg: 'Курс с този код вече съществува',
    en: 'A course with this code already exists',
  },
  COURSE_CREATED: {
    bg: 'Курсът е създаден успешно',
    en: 'Course created successfully',
  },
  COURSE_CREATE_ERROR: {
    bg: 'Грешка при създаване на курса',
    en: 'Failed to create course',
  },
  NO_RIGHTS_EDIT_COURSE: {
    bg: 'Нямате права да редактирате този курс',
    en: 'You cannot edit this course',
  },
  COURSE_UPDATED: {
    bg: 'Курсът е обновен успешно',
    en: 'Course updated successfully',
  },
  COURSE_UPDATE_ERROR: {
    bg: 'Грешка при обновяване на курса',
    en: 'Failed to update course',
  },
  NO_RIGHTS_ADD_STUDENTS: {
    bg: 'Нямате права да добавяте студенти към този курс',
    en: 'You cannot add students to this course',
  },
  ADD_STUDENTS_ERROR: {
    bg: 'Грешка при добавяне на студенти',
    en: 'Failed to add students',
  },
  NO_RIGHTS_REMOVE_STUDENTS: {
    bg: 'Нямате права да премахвате студенти от този курс',
    en: 'You cannot remove students from this course',
  },
  STUDENT_NOT_IN_COURSE: {
    bg: 'Студентът не е намерен в курса',
    en: 'Student not found in this course',
  },
  STUDENT_REMOVED: {
    bg: 'Студентът е премахнат от курса',
    en: 'Student removed from course',
  },
  REMOVE_STUDENT_ERROR: {
    bg: 'Грешка при премахване на студента',
    en: 'Failed to remove student',
  },
  IS_ACTIVE_REQUIRED: {
    bg: 'Подайте isActive: true или false',
    en: 'Provide isActive: true or false',
  },
  GROUP_RESTORED: {
    bg: 'Групата е възстановена',
    en: 'Group restored',
  },
  GROUP_ARCHIVED: {
    bg: 'Групата е архивирана',
    en: 'Group archived',
  },
  GROUP_STATUS_ERROR: {
    bg: 'Грешка при промяна на статуса на групата',
    en: 'Failed to change group status',
  },
  NO_RIGHTS_DELETE_COURSE: {
    bg: 'Нямате права да изтриете този курс',
    en: 'You cannot delete this course',
  },
  COURSE_DELETED: {
    bg: 'Курсът е изтрит успешно',
    en: 'Course deleted successfully',
  },
  COURSE_DELETE_ERROR: {
    bg: 'Грешка при изтриване на курса',
    en: 'Failed to delete course',
  },
  ANALYTICS_ERROR: {
    bg: 'Грешка при аналитиката',
    en: 'Analytics failed',
  },
  NO_ACCESS_COURSE_STATS: {
    bg: 'Нямате достъп до статистиките на този курс',
    en: 'You do not have access to this course statistics',
  },
  LOAD_STATS_ERROR: {
    bg: 'Грешка при зареждане на статистиките',
    en: 'Failed to load statistics',
  },
  LOAD_GROUPS_ERROR: {
    bg: 'Грешка при зареждане на групите',
    en: 'Failed to load groups',
  },
  GROUP_CODE_REQUIRED: {
    bg: 'Въведете код на групата',
    en: 'Enter the group code',
  },
  GROUP_NOT_FOUND: {
    bg: 'Група с този код не е намерена',
    en: 'No group found with this code',
  },
  GROUP_ARCHIVED_NO_JOIN: {
    bg: 'Тази група е архивирана и не приема нови ученици',
    en: 'This group is archived and does not accept new students',
  },
  ALREADY_IN_GROUP: {
    bg: 'Вече сте член на тази група',
    en: 'You are already a member of this group',
  },
  STUDENTS_ONLY_JOIN: {
    bg: 'Само ученически акаунти могат да се присъединяват към група',
    en: 'Only student accounts can join a group',
  },
  JOIN_GROUP_ERROR: {
    bg: 'Грешка при присъединяване',
    en: 'Failed to join group',
  },
  ASSIGNMENT_INACTIVE: {
    bg: 'Заданието вече не е активно',
    en: 'This assignment is no longer active',
  },
  INVALID_VARIANT: {
    bg: 'Невалиден вариант',
    en: 'Invalid variant',
  },
  MAX_ATTEMPTS_REACHED: {
    bg: 'Достигнат максималният брой опити',
    en: 'Maximum number of attempts reached',
  },
  SUBMISSION_SENT: {
    bg: 'Submission е изпратен успешно',
    en: 'Submission sent successfully',
  },
  SUBMISSION_SEND_ERROR: {
    bg: 'Грешка при изпращане на submission',
    en: 'Failed to submit',
  },
  NO_ACCESS_SUBMISSION: {
    bg: 'Нямате достъп до този submission',
    en: 'You do not have access to this submission',
  },
  LOAD_SUBMISSION_ERROR: {
    bg: 'Грешка при зареждане на submission',
    en: 'Failed to load submission',
  },
  TEACHER_ACCESS_ALREADY: {
    bg: 'Вече имате достъп като преподавател',
    en: 'You already have teacher access',
  },
  TEACHER_REQUEST_PENDING: {
    bg: 'Заявката вече е изпратена и чака одобрение',
    en: 'Your request was already submitted and is pending approval',
  },
  TEACHER_REQUEST_RESENT: {
    bg: 'Заявката е изпратена отново',
    en: 'Request sent again',
  },
  TEACHER_REQUEST_SENT: {
    bg: 'Заявката е изпратена. Ще получите известие след преглед.',
    en: 'Request submitted. You will be notified after review.',
  },
  REQUEST_NOT_FOUND: {
    bg: 'Заявката не е намерена',
    en: 'Request not found',
  },
  REQUEST_ARCHIVED: {
    bg: 'Заявката е архивирана',
    en: 'Request archived',
  },
  REJECT_REASON_REQUIRED: {
    bg: 'Посочете причина за отказ (минимум 3 символа)',
    en: 'Provide a rejection reason (at least 3 characters)',
  },
  REQUEST_DELETED: {
    bg: 'Заявката е изтрита. Потребителят може да подаде нова.',
    en: 'Request deleted. The user can submit a new one.',
  },
  ALL_NOTIFICATIONS_READ: {
    bg: 'Всички известия са прочетени',
    en: 'All notifications marked as read',
  },
  NOTIFICATION_NOT_FOUND: {
    bg: 'Известието не е намерено',
    en: 'Notification not found',
  },
  USER_DELETED: {
    bg: 'Потребителят е изтрит успешно.',
    en: 'User deleted successfully.',
  },
  LOAD_OVERVIEW_ERROR: {
    bg: 'Грешка при зареждане на обзора',
    en: 'Failed to load overview',
  },
  TITLE_TOOL_REQUIRED: {
    bg: 'Заглавие и инструмент са задължителни',
    en: 'Title and tool are required',
  },
  TEMPLATE_NOT_FOUND: {
    bg: 'Шаблонът не е намерен',
    en: 'Template not found',
  },
  TEMPLATE_DELETED: {
    bg: 'Изтрит',
    en: 'Deleted',
  },
  LOAD_BUILTIN_TEMPLATES_ERROR: {
    bg: 'Грешка при зареждане на вградените шаблони',
    en: 'Failed to load built-in templates',
  },
  LOAD_TEMPLATES_ERROR: {
    bg: 'Грешка при зареждане на шаблоните за задачи',
    en: 'Failed to load task templates',
  },
  NO_ACCESS_TEMPLATE: {
    bg: 'Нямате достъп до този шаблон',
    en: 'You do not have access to this template',
  },
  LOAD_TEMPLATE_ERROR: {
    bg: 'Грешка при зареждане на шаблона',
    en: 'Failed to load template',
  },
  GENERATOR_SCRIPT_ERROR: {
    bg: 'Грешка в генераторния скрипт',
    en: 'Generator script error',
  },
  SOLUTION_SCRIPT_ERROR: {
    bg: 'Грешка в решението скрипт',
    en: 'Solution script error',
  },
  TEMPLATE_CREATED: {
    bg: 'Шаблонът за задача е създаден успешно',
    en: 'Task template created successfully',
  },
  TEMPLATE_CREATE_ERROR: {
    bg: 'Грешка при създаване на шаблона',
    en: 'Failed to create template',
  },
  NO_RIGHTS_EDIT_TEMPLATE: {
    bg: 'Нямате права да редактирате този шаблон',
    en: 'You cannot edit this template',
  },
  TEMPLATE_UPDATED: {
    bg: 'Шаблонът е обновен успешно',
    en: 'Template updated successfully',
  },
  TEMPLATE_UPDATE_ERROR: {
    bg: 'Грешка при обновяване на шаблона',
    en: 'Failed to update template',
  },
  NO_RIGHTS_DELETE_TEMPLATE: {
    bg: 'Нямате права да изтриете този шаблон',
    en: 'You cannot delete this template',
  },
  TEMPLATE_DELETED_SUCCESS: {
    bg: 'Шаблонът е изтрит успешно',
    en: 'Template deleted successfully',
  },
  TEMPLATE_DELETE_ERROR: {
    bg: 'Грешка при изтриване на шаблона',
    en: 'Failed to delete template',
  },
  NO_RIGHTS_TEST_TEMPLATE: {
    bg: 'Нямате права да тествате този шаблон',
    en: 'You cannot test this template',
  },
  TEMPLATE_TEST_ERROR: {
    bg: 'Грешка при тестване на шаблона',
    en: 'Failed to test template',
  },
  EDU_CONTEXT_MISSING: {
    bg: 'Липсва контекст на задание',
    en: 'Assignment context is missing',
  },
  GROUP_NOT_FOUND_EDU: {
    bg: 'Групата не е намерена',
    en: 'Group not found',
  },
  CALCULATOR_NOT_ALLOWED: {
    bg: 'За това задание калкулаторът не е разрешен от преподавателя',
    en: 'The calculator is not allowed for this assignment by the teacher',
  },
};

/** Bulgarian text → message key (legacy responses) */
const BG_TEXT_TO_KEY = {};
for (const [key, texts] of Object.entries(MESSAGES)) {
  BG_TEXT_TO_KEY[texts.bg] = key;
}

/** Dynamic Bulgarian patterns → EN template with {placeholders} */
const DYNAMIC_PATTERNS = [
  {
    re: /^Добавени (\d+) студенти към курса$/,
    en: (m) => `Added ${m[1]} students to the course`,
  },
  {
    re: /^Успешно се присъединихте към „(.+)"$/,
    en: (m) => `You have successfully joined "${m[1]}"`,
  },
  {
    re: /^Ролята на потребителя е променена на (.+)\.$/,
    en: (m) => `User role changed to ${m[1]}.`,
  },
];

const LANG_HEADER = 'x-geosolver-language';

function normalizeLang(raw) {
  if (!raw || typeof raw !== 'string') return 'bg';
  const v = raw.trim().toLowerCase();
  if (v === 'en' || v.startsWith('en-')) return 'en';
  return 'bg';
}

function resolveLang(req) {
  const explicit = req.headers[LANG_HEADER] || req.headers['X-GeoSolver-Language'];
  if (explicit) return normalizeLang(explicit);

  const queryLang = req.query?.lang;
  if (queryLang) return normalizeLang(queryLang);

  const accept = req.headers['accept-language'];
  if (accept) {
    const parts = accept.split(',').map((p) => p.trim().split(';')[0]);
    if (parts.some((p) => p.toLowerCase().startsWith('en'))) return 'en';
  }

  return 'bg';
}

function msg(lang, key, vars = {}) {
  const entry = MESSAGES[key];
  if (!entry) return key;
  let text = entry[lang] || entry.bg || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return text;
}

function translateMessage(text, lang) {
  if (!text || typeof text !== 'string' || lang === 'bg') return text;

  const key = BG_TEXT_TO_KEY[text];
  if (key) return msg('en', key);

  for (const { re, en } of DYNAMIC_PATTERNS) {
    const m = text.match(re);
    if (m) return en(m);
  }

  return text;
}

function localizeBody(body, lang) {
  if (!body || typeof body !== 'object' || lang === 'bg') return body;
  const out = { ...body };
  for (const field of ['message', 'error', 'detail']) {
    if (typeof out[field] === 'string') {
      out[field] = translateMessage(out[field], lang);
    }
  }
  return out;
}

module.exports = {
  MESSAGES,
  LANG_HEADER,
  normalizeLang,
  resolveLang,
  msg,
  translateMessage,
  localizeBody,
};
