const fs = require('fs');
const path = require('path');

// Create uploads directory for file uploads
const uploadsDir = path.join(__dirname, 'uploads', 'submissions');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('✅ Created uploads directory');
}

// Create .env file if it doesn't exist
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  const envContent = `# Database
MONGODB_URI=mongodb://localhost:27017/geosolver

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key-here

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

# Server Configuration
PORT=5000
NODE_ENV=development

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
`;
  
  fs.writeFileSync(envPath, envContent);
  console.log('✅ Created .env file - please update with your actual values');
}

console.log('🚀 Backend setup complete!');
console.log('📝 Next steps:');
console.log('1. Update .env file with your MongoDB URI and email credentials');
console.log('2. Run: npm install');
console.log('3. Run: npm start');
