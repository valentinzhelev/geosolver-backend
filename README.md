# GeoSolver Backend API

A robust Node.js backend service providing RESTful API endpoints for the GeoSolver geodetic calculation platform. This service handles user authentication, calculation persistence, data management, and secure communication between the frontend application and database.

## Overview

The GeoSolver Backend API is designed to support a comprehensive geodetic calculation platform with enterprise-grade security, scalability, and performance. It provides secure endpoints for user management, calculation storage, and data retrieval while maintaining high standards for code quality and security practices.

## Technical Stack

### Core Technologies
- **Node.js** - JavaScript runtime environment
- **Express.js** - Web application framework
- **MongoDB** - NoSQL document database
- **Mongoose** - MongoDB object modeling library

### Security & Authentication
- **JWT (JSON Web Tokens)** - Stateless authentication
- **bcryptjs** - Password hashing and security
- **CORS** - Cross-origin resource sharing
- **Helmet** - Security middleware
- **Rate Limiting** - API request throttling

### Additional Services
- **Nodemailer** - Email service integration
- **dotenv** - Environment configuration management
- **Railway** - Cloud hosting and deployment platform

## Project Architecture

```
geosolver-backend/
├── models/              # Database schemas and models
│   ├── User.js         # User authentication and profile
│   ├── Calculation.js  # Calculation history and data
│   ├── Assignment.js   # Educational assignments
│   ├── Class.js        # Classroom management
│   └── ...
├── routes/              # API route handlers
│   ├── auth.js         # Authentication endpoints
│   ├── calculations.js # Calculation CRUD operations
│   ├── assignments.js  # Assignment management
│   └── ...
├── middleware/          # Custom middleware functions
│   ├── auth.js         # JWT authentication middleware
│   └── role.js         # Role-based access control
├── utils/               # Utility functions and helpers
│   └── mailer.js       # Email service utilities
└── index.js            # Application entry point
```

## API Endpoints

### Authentication & User Management
```
POST   /api/auth/register          # User registration
POST   /api/auth/login             # User authentication
POST   /api/auth/forgot-password   # Password recovery
POST   /api/auth/reset-password    # Password reset
GET    /api/auth/verify-email      # Email verification
```

### Calculation Management
```
GET    /api/calculations           # Retrieve user calculations
POST   /api/calculations           # Save new calculation
GET    /api/calculations/:id       # Get specific calculation
PUT    /api/calculations/:id       # Update calculation
DELETE /api/calculations/:id       # Delete calculation
```

### Educational Features
```
GET    /api/assignments            # Get assignments
POST   /api/assignments            # Create assignment
GET    /api/classes                # Get classes
POST   /api/classes                # Create class
GET    /api/students               # Get students
```

### Data Management
```
GET    /api/history                # Calculation history
POST   /api/submissions            # Submit calculation
GET    /api/plans                  # Subscription plans
POST   /api/payments               # Payment processing
```

## Security Implementation

### Authentication Flow
- JWT-based stateless authentication
- Secure password hashing with bcrypt (12 rounds)
- Email verification for new accounts
- Password reset functionality with secure tokens

### Data Protection
- Input validation and sanitization
- SQL injection prevention through Mongoose
- CORS configuration for cross-origin requests
- Rate limiting to prevent abuse
- Environment variable protection

### API Security
- Protected routes with authentication middleware
- Role-based access control (RBAC)
- Request validation and error handling
- Secure headers with Helmet middleware

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- MongoDB Atlas account or local MongoDB instance
- Email service credentials (for notifications)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/valentinzhelev/geosolver-backend.git
cd geosolver-backend
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Update `.env` with your configuration:
```env
PORT=5000
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/geosolver
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
FRONTEND_URL=http://localhost:3000
```

5. Start the development server:
```bash
npm start
```

The API will be available at `http://localhost:5000`

## Database Schema

### User Model
- Authentication credentials
- Profile information
- Subscription details
- Role and permissions

### Calculation Model
- Calculation type and parameters
- Results and metadata
- User association
- Timestamp and versioning

### Assignment Model
- Educational assignments
- Student submissions
- Grading and feedback
- Class associations

## Development

### Code Standards
- Follow Node.js and Express.js best practices
- Use async/await for asynchronous operations
- Implement comprehensive error handling
- Write clean, documented code with JSDoc
- Follow RESTful API design principles

### Testing Strategy
- Unit tests for utility functions
- Integration tests for API endpoints
- Authentication flow testing
- Database operation testing

### Performance Optimization
- Database indexing for query optimization
- Response caching for frequently accessed data
- Connection pooling for database efficiency
- Request compression and optimization

## Deployment

### Production Environment
- Deployed on Railway with automatic CI/CD
- MongoDB Atlas for managed database service
- Environment variables managed through Railway
- SSL/TLS encryption for secure communication

### Monitoring & Logging
- Application performance monitoring
- Error tracking and logging
- Database performance metrics
- API usage analytics

## API Documentation

For detailed API documentation including request/response schemas, authentication requirements, and error codes, please refer to the [Frontend Repository](https://github.com/valentinzhelev/geosolver.bg) or contact the development team.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contact

**Valentin Zhelev**
- LinkedIn: [linkedin.com/in/valentinzhelev](https://www.linkedin.com/in/valentin-zhelev-9b5b30346/)
- Email: valentin.zhelevbg@gmail.com