# 🔧 GeoSolver Backend API

Backend service for the GeoSolver application, providing RESTful API endpoints for calculation history, user management, and data persistence.

## 🛠️ Technologies Used

- [Node.js](https://nodejs.org/) - JavaScript runtime
- [Express.js](https://expressjs.com/) - Web framework
- [MongoDB](https://www.mongodb.com/) - NoSQL database
- [Mongoose](https://mongoosejs.com/) - MongoDB object modeling
- [JWT](https://jwt.io/) - Authentication
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js/) - Password hashing
- [Nodemailer](https://nodemailer.com/) - Email functionality
- [CORS](https://github.com/expressjs/cors) - Cross-origin resource sharing
- [dotenv](https://github.com/motdotla/dotenv) - Environment configuration
- [Railway](https://railway.app/) - Cloud hosting and deployment platform

## 🏗️ Project Structure

```
geosolver-backend/
├── models/         # Database models
├── routes/         # API routes
├── middleware/     # Custom middleware
├── utils/          # Utility functions
└── index.js        # Application entry point
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- MongoDB instance (local or Atlas)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/<your-username>/geosolver-backend.git
cd geosolver-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
EMAIL_USER=your_email
EMAIL_PASS=your_email_password
```

4. Start the server:
```bash
npm start
```

The API will be available at `http://localhost:5000`

## 📡 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/forgot-password` - Password recovery

### Calculations
- `GET /api/calculations` - Get calculation history
- `POST /api/calculations` - Save new calculation
- `GET /api/calculations/:id` - Get specific calculation
- `DELETE /api/calculations/:id` - Delete calculation

## 🔒 Security Features

- JWT-based authentication
- Password hashing with bcrypt
- CORS protection
- Environment variable configuration
- Input validation
- Rate limiting

## 📦 Deployment

The backend is deployed on Railway with automatic deployments from the main branch.

## 🧪 Development Guidelines

- Follow REST API best practices
- Use async/await for asynchronous operations
- Implement proper error handling
- Write clean, documented code
- Follow the established folder structure

## 📜 License

This project is licensed under the MIT License.

## 🤝 Contributions

We welcome contributions! Please fork the repo and submit a pull request. For major changes, open an issue first to discuss the idea.

## 📬 Contact
Created and maintained by **@valentinjelev**
Feel free to reach out for feedback, suggestions, or collaboration. 