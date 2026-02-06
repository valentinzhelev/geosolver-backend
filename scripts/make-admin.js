/**
 * Script to assign administrator role to a user
 * 
 * Usage:
 * node scripts/make-admin.js <email>
 * 
 * Example:
 * node scripts/make-admin.js user@example.com
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function makeAdmin() {
  try {
    const email = process.argv[2];
    
    if (!email) {
      console.error('Please provide email address:');
      console.log('   node scripts/make-admin.js <email>');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB');

    const user = await User.findOne({ email });
    
    if (!user) {
      console.error(`User with email "${email}" not found.`);
      process.exit(1);
    }

    if (user.role === 'admin') {
      console.log(`User "${user.name}" (${user.email}) is already an administrator.`);
      process.exit(0);
    }

    user.role = 'admin';
    await user.save();

    console.log(`User "${user.name}" (${user.email}) has been made administrator.`);
    console.log(`   Old role: ${user.role === 'admin' ? 'admin' : 'non-admin'}`);
    console.log(`   New role: admin`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

makeAdmin();
