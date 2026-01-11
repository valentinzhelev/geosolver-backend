/**
 * Скрипт за задаване на администраторска роля на потребител
 * 
 * Използване:
 * node scripts/make-admin.js <email>
 * 
 * Пример:
 * node scripts/make-admin.js valentin.jelev@abv.bg
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function makeAdmin() {
  try {
    const email = process.argv[2];
    
    if (!email) {
      console.error('❌ Моля, предоставете имейл адрес:');
      console.log('   node scripts/make-admin.js <email>');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('✅ Свързан с MongoDB');

    const user = await User.findOne({ email });
    
    if (!user) {
      console.error(`❌ Потребител с имейл "${email}" не е намерен.`);
      process.exit(1);
    }

    if (user.role === 'admin') {
      console.log(`ℹ️  Потребителят "${user.name}" (${user.email}) вече е администратор.`);
      process.exit(0);
    }

    user.role = 'admin';
    await user.save();

    console.log(`✅ Потребителят "${user.name}" (${user.email}) е направен администратор.`);
    console.log(`   Стара роля: ${user.role === 'admin' ? 'admin' : 'не-admin'}`);
    console.log(`   Нова роля: admin`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Грешка:', error);
    process.exit(1);
  }
}

makeAdmin();
