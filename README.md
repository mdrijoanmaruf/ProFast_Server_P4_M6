# ProFast Server

Backend API for ProFast parcel delivery service built with Node.js, Express, and MongoDB.

## Features

- User authentication with Firebase
- Parcel booking and tracking
- Payment processing with Stripe
- Rider management system
- Admin dashboard functionality

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create .env file**
   ```env
   DB_USER=your_mongodb_username
   DB_PASS=your_mongodb_password
   STRIPE_SECRET_KEY=your_stripe_secret_key
   PORT=5000
   ```

3. **Add Firebase Admin Key**
   - Place your `FirebaseAdminKey.json` file in the root directory

4. **Start the server**
   ```bash
   npm start
   ```

## API Endpoints

### Authentication
- `POST /users` - Create user
- `GET /users/role/:email` - Get user role

### Parcels
- `POST /parcels` - Create parcel
- `GET /parcels` - Get parcels
- `GET /parcels/:id` - Get parcel by ID
- `GET /parcels/track/:trackingNumber` - Track parcel
- `PATCH /parcels/:id/assign-rider` - Assign rider

### Riders
- `POST /riders` - Create rider
- `GET /riders` - Get riders
- `PATCH /riders/:id/status` - Update rider status

### Payments
- `POST /create-payment-intent` - Create payment
- `GET /payments` - Get payment history

## Tech Stack

- **Node.js** - Runtime
- **Express.js** - Web framework
- **MongoDB** - Database
- **Firebase** - Authentication
- **Stripe** - Payment processing

## Environment

```
http://localhost:5000
```

## Author

Rijoan Maruf
