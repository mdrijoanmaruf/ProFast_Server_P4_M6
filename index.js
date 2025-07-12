const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require('stripe');
const admin = require("firebase-admin");

// Load environment variables
dotenv.config();

// Initialize Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeInstance = stripe(stripeSecretKey);

// Create Express app
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());


let serviceAccount = require("./FirebaseAdminKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


const user = process.env.DB_USER;
const pass = process.env.DB_PASS;

const uri = `mongodb+srv://${user}:${pass}@cluster0.0ykpaho.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {

    const db = client.db('proFast');
    const parcelCollection = db.collection('parcels')
    const paymentCollection = db.collection('payments')
    const usersCollection = db.collection('users')
    const ridersCollection = db.collection('rider')

    // Custom MiddleWares
    const verifyFirebaseToken = async(req , res , next) => {
      console.log("Headers in middleware : " , req.headers)
      const authHeader = req.headers.authorization;

      if(!authHeader) {
        return res.status(401).send({message : "Unauthorized Access"})
      }

      const token = authHeader.split(' ')[1];

      if(!token){
        return res.status(401).send({message : "Unauthorized Access"})
      }

      try {
        // Verify The Token
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
      } catch (error) {
        console.error('Token verification failed:', error);
        return res.status(401).send({message : "Invalid Token"});
      }
    }

    const verifyAdmin = async (req , res , next) => {
      const email = req.decoded.email;

      const query = {email}
      const user = await usersCollection.findOne(query)
      if(!user || user.role !== 'admin'){
        return res.status(403).send({message : 'Forbidden Access'})
      }
      next()
    }

    // Users
    app.post('/users' , async (req , res) => {
      const email = req.body.email;
      const userExists = await usersCollection.findOne({email})

      // TODO : Update last log in info
      if(userExists){
        return res.status(200).send({message : "User already exists" , inserted: false})
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result)
    })

    // Get API - Fetch all users with role filter
    app.get('/users', verifyFirebaseToken, async (req, res) => {
      try {
        const role = req.query.role;
        const search = req.query.search;
        
        let query = {};
        
        // Filter by role if provided (admin, user, rider)
        if (role) {
          query.role = role;
        } else {
          // If no role specified, get admin and user roles only (exclude riders)
          query.role = { $in: ['admin', 'user'] };
        }
        
        // Add search functionality
        if (search) {
          query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
          ];
        }

        const options = {
          sort: { createdAt: -1 }
        };

        const users = await usersCollection.find(query, options).toArray();
        res.send(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ 
          success: false,
          message: "Failed to fetch users" 
        });
      }
    })

    // PATCH API - Update user role
    app.patch('/users/:id/role', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { role } = req.body;

        const validRoles = ['admin', 'user', 'rider'];
        
        if (!validRoles.includes(role)) {
          return res.status(400).send({
            success: false,
            message: "Invalid role. Must be 'admin', 'user', or 'rider'"
          });
        }

        // Get user information before updating
        const user = await usersCollection.findOne({ _id: new ObjectId(id) });
        
        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found"
          });
        }

        const updateData = {
          role: role,
          updatedAt: new Date().toISOString()
        };

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "User not found"
          });
        }

        res.send({
          success: true,
          message: `User role updated to ${role} successfully`,
          modifiedCount: result.modifiedCount
        });
      } catch (error) {
        console.error("Error updating user role:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update user role"
        });
      }
    })

    // GET API - Get user role by email
    app.get('/users/role/:email', verifyFirebaseToken, async (req, res) => {
      try {
        const email = req.params.email;
        
        if (!email) {
          return res.status(400).send({
            success: false,
            message: "Email is required"
          });
        }

        const user = await usersCollection.findOne({ email: email });
        
        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
            role: null
          });
        }

        res.send({
          success: true,
          email: user.email,
          role: user.role || 'user', // Default to 'user' if no role is set
          name: user.name || null
        });
      } catch (error) {
        console.error("Error fetching user role:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch user role"
        });
      }
    })

    // All API

    // Post API - Create a new parcel
    app.post('/parcels', verifyFirebaseToken, async (req, res) => {
      try {
        const parcelData = req.body;
        const result = await parcelCollection.insertOne(parcelData);
        res.send(result);
      } catch (error) {
        res.status(500).send(error);
      }
    })

    // Get API - Fetch all parcel data of user
    app.get('/parcels', verifyFirebaseToken, async (req , res) => {
      try{
        const userEmail = req.query.email;
        const query = userEmail ? {userEmail : userEmail} : {};

        const options = {
          sort : {createdAt : -1},
        }

        const parcels = await parcelCollection.find(query , options).toArray();
        res.send(parcels)
      }
      catch(error) {
        console.error("Error Fetching parcels : " , error);
        res.status(500).send({massage : "Failed to get Parcels"})
      }
    })

    // Delete API - Delete a parcel 
    app.delete('/parcels/:id', verifyFirebaseToken, async (req , res) => {
      try{
        const id = req.params.id;

        const result = await parcelCollection.deleteOne({_id: new ObjectId(id)})
        
        if (result.deletedCount > 0) {
          res.send({
            success: true,
            message: "Parcel deleted successfully",
            deletedCount: result.deletedCount
          });
        } else {
          res.status(404).send({
            success: false,
            message: "Parcel not found"
          });
        }
      }
      catch(error) {
        console.error("Error deleting parcel : " , error)
        res.status(500).send({
          success: false,
          message: "Failed to delete parcel"
        })
      }
    })

    // Raiders
    app.post('/riders' , verifyAdmin , verifyFirebaseToken ,  async (req , res) => {
      const rider = req.body;
      rider.status = 'pending'; // Set default status
      rider.createdAt = new Date().toISOString();
      const result = await ridersCollection.insertOne(rider)
      res.send(result)
    })

    // Get all riders with optional status filter
    app.get('/riders', verifyFirebaseToken, async (req, res) => {
      try {
        const status = req.query.status;
        const query = status ? { status: status } : {};
        
        console.log('Riders query:', query);

        const options = {
          sort: { createdAt: -1 }
        };

        const riders = await ridersCollection.find(query, options).toArray();
        console.log(`Found ${riders.length} riders with status: ${status || 'all'}`);
        
        res.send(riders);
      } catch (error) {
        console.error("Error fetching riders:", error);
        res.status(500).send({ message: "Failed to fetch riders" });
      }
    })

    // Update rider status
    app.patch('/riders/:id/status', verifyFirebaseToken, verifyAdmin ,  async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        const validStatuses = ['pending', 'active', 'rejected'];
        
        if (!validStatuses.includes(status)) {
          return res.status(400).send({
            success: false,
            message: "Invalid status"
          });
        }

        // Get rider information before updating
        const rider = await ridersCollection.findOne({ _id: new ObjectId(id) });
        
        if (!rider) {
          return res.status(404).send({
            success: false,
            message: "Rider not found"
          });
        }

        const updateData = {
          status: status,
          updatedAt: new Date().toISOString()
        };

        const result = await ridersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Rider not found"
          });
        }

        // If rider is being activated, create a user with role 'rider'
        if (status === 'active') {
          try {
            // Check if user already exists
            const existingUser = await usersCollection.findOne({ email: rider.email });
            
            if (!existingUser) {
              // Create new user with rider role
              const newUser = {
                email: rider.email,
                name: rider.fullName,
                role: 'rider',
                phone: rider.phone,
                address: rider.address,
                dateOfBirth: rider.dateOfBirth,
                vehicleType: rider.vehicleType,
                vehicleModel: rider.vehicleModel,
                licensePlate: rider.licensePlate,
                riderId: id, // Reference to rider document
                createdAt: new Date().toISOString(),
                lastLoginAt: null,
                isActive: true
              };

              await usersCollection.insertOne(newUser);
              console.log(`User created for rider: ${rider.email}`);
            } else {
              // Update existing user to add rider role if they don't have it
              if (existingUser.role !== 'rider') {
                await usersCollection.updateOne(
                  { email: rider.email },
                  { 
                    $set: { 
                      role: 'rider',
                      riderId: id,
                      vehicleType: rider.vehicleType,
                      vehicleModel: rider.vehicleModel,
                      licensePlate: rider.licensePlate,
                      updatedAt: new Date().toISOString()
                    } 
                  }
                );
                console.log(`User role updated to rider for: ${rider.email}`);
              }
            }
          } catch (userError) {
            console.error("Error creating/updating user for rider:", userError);
            // Don't fail the rider activation if user creation fails
          }
        }

        res.send({
          success: true,
          message: status === 'active' 
            ? "Rider status updated successfully and user account created" 
            : "Rider status updated successfully",
          modifiedCount: result.modifiedCount
        });
      } catch (error) {
        console.error("Error updating rider status:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update rider status"
        });
      }
    })

    // Delete rider (for rejection)
    app.delete('/riders/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;

        const result = await ridersCollection.deleteOne({ _id: new ObjectId(id) });
        
        if (result.deletedCount > 0) {
          res.send({
            success: true,
            message: "Rider deleted successfully",
            deletedCount: result.deletedCount
          });
        } else {
          res.status(404).send({
            success: false,
            message: "Rider not found"
          });
        }
      } catch (error) {
        console.error("Error deleting rider:", error);
        res.status(500).send({
          success: false,
          message: "Failed to delete rider"
        });
      }
    })

    // Get API - Fetch parcel data by id
    app.get('/parcels/:id', verifyFirebaseToken, async (req , res) => {
      try {
        const id = req.params.id;
        const parcel = await parcelCollection.findOne({_id: new ObjectId(id)});

        if(!parcel){
          return res.status(404).send({message : "Parcel Not Found"})
        }
        res.send(parcel)
      }
      catch(error){
        console.log(error)
      }
    })

    // Get API - Search parcel by tracking number
    app.get('/parcels/track/:trackingNumber', async (req, res) => {
      try {
        const trackingNumber = req.params.trackingNumber;
        const parcel = await parcelCollection.findOne({trackingNumber: trackingNumber});

        if(!parcel){
          return res.status(404).send({
            success: false,
            message: "Parcel not found with this tracking number"
          })
        }
        
        res.send({
          success: true,
          data: parcel
        })
      }
      catch(error){
        console.error("Error searching parcel by tracking number:", error)
        res.status(500).send({
          success: false,
          message: "Failed to search parcel"
        })
      }
    })

    // PATCH API - Update parcel status (for admin/delivery updates)
    app.patch('/parcels/:id/status', verifyFirebaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { status, updateNote } = req.body;

        const validStatuses = ['pending', 'paid', 'processing', 'shipped', 'in-transit', 'out-for-delivery', 'delivered', 'cancelled'];
        
        if (!validStatuses.includes(status)) {
          return res.status(400).send({
            success: false,
            message: "Invalid status"
          });
        }

        const updateData = {
          status: status,
          updatedAt: new Date().toISOString()
        };

        if (updateNote) {
          updateData.lastUpdateNote = updateNote;
        }

        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Parcel not found"
          });
        }

        res.send({
          success: true,
          message: "Parcel status updated successfully",
          modifiedCount: result.modifiedCount
        });
      } catch (error) {
        console.error("Error updating parcel status:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update parcel status"
        });
      }
    })

    // PATCH API - Update parcel payment status and store payment history
    app.patch('/parcels/:id/payment', verifyFirebaseToken, async (req, res) => {
      
      try {
        const id = req.params.id;
        const { paymentIntentId, status, paymentAmount, paymentDate, userEmail } = req.body;

        // Get parcel information before updating
        const parcel = await parcelCollection.findOne({_id: new ObjectId(id)});
        if (!parcel) {
          return res.status(404).send({
            success: false,
            message: "Parcel not found"
          });
        }

        // Store payment history in paymentCollection
        const paymentRecord = {
          parcelId: id,
          parcelTrackingNumber: parcel.trackingNumber,
          userEmail: userEmail || parcel.userEmail,
          paymentIntentId: paymentIntentId,
          paymentAmount: paymentAmount,
          paymentDate: paymentDate,
          paymentStatus: status,
          parcelTitle: parcel.title,
          senderName: parcel.senderName,
          receiverName: parcel.receiverName,
          senderRegion: parcel.senderRegion,
          receiverRegion: parcel.receiverRegion,
          createdAt: new Date().toISOString()
        };

        await paymentCollection.insertOne(paymentRecord);

        // Update parcel status
        const updateData = {
          status: status === 'paid' ? 'paid' : 'pending',
          paymentStatus: status,
          paymentIntentId: paymentIntentId,
          paymentAmount: paymentAmount,
          paymentDate: paymentDate,
          updatedAt: new Date().toISOString()
        };

        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        res.send({
          success: true,
          message: "Payment processed and parcel status updated successfully",
          modifiedCount: result.modifiedCount,
          paymentRecorded: true
        });
      } catch (error) {
        console.error("Error updating payment status:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update payment status"
        });
      }
    })

    // PATCH API - Assign rider to parcel
    app.patch('/parcels/:id/assign-rider', verifyFirebaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { riderId, riderName, riderEmail, riderPhone, vehicleType, assignedAt, status } = req.body;

        console.log('Assign rider request:', { id, riderId, riderName, riderEmail });

        // Validate required fields
        if (!riderId || !riderName || !riderEmail) {
          return res.status(400).send({
            success: false,
            message: "riderId, riderName, and riderEmail are required"
          });
        }

        // Get parcel information before updating
        const parcel = await parcelCollection.findOne({_id: new ObjectId(id)});
        if (!parcel) {
          return res.status(404).send({
            success: false,
            message: "Parcel not found"
          });
        }

        console.log('Found parcel:', parcel.trackingNumber);

        // Check if parcel is eligible for assignment (must be paid)
        if (parcel.paymentStatus !== 'paid' || parcel.status !== 'paid') {
          return res.status(400).send({
            success: false,
            message: "Parcel must be paid before rider assignment"
          });
        }

        // Check if parcel is already assigned
        if (parcel.assignedRider) {
          return res.status(400).send({
            success: false,
            message: "Parcel is already assigned to a rider"
          });
        }

        // Verify rider exists and is active
        const rider = await ridersCollection.findOne({
          _id: new ObjectId(riderId),
          status: 'active'
        });

        if (!rider) {
          return res.status(404).send({
            success: false,
            message: "Active rider not found"
          });
        }

        console.log('Found rider:', rider.name || rider.fullName);

        // Update parcel with rider assignment
        const updateData = {
          assignedRider: {
            riderId: riderId,
            riderName: riderName,
            riderEmail: riderEmail,
            riderPhone: riderPhone || rider.phone,
            vehicleType: vehicleType || rider.vehicleType,
            assignedAt: assignedAt || new Date().toISOString()
          },
          status: status || 'assigned',
          assignedAt: assignedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        console.log('Update result:', result);

        if (result.matchedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Parcel not found"
          });
        }

        res.send({
          success: true,
          message: `Parcel ${parcel.trackingNumber} successfully assigned to ${riderName}`,
          data: {
            parcelId: id,
            trackingNumber: parcel.trackingNumber,
            assignedRider: updateData.assignedRider,
            modifiedCount: result.modifiedCount
          }
        });

      } catch (error) {
        console.error("Error assigning rider to parcel:", error);
        res.status(500).send({
          success: false,
          message: "Failed to assign rider to parcel",
          error: error.message
        });
      }
    })

    // Get API - Fetch payment history
    app.get('/payments', verifyFirebaseToken ,  async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? {userEmail: userEmail} : {};

        const options = {
          sort: {createdAt: -1}
        };

        const payments = await paymentCollection.find(query, options).toArray();
        res.send(payments);
      } catch (error) {
        console.error("Error fetching payment history:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch payment history"
        });
      }
    })

    // Stripe Payment APIs

    // Create Payment Intent
    app.post('/create-payment-intent', verifyFirebaseToken, async (req, res) => {
      try {
        const { amount, parcelId } = req.body;

        // Validate required fields
        if (!amount || !parcelId) {
          return res.status(400).send({
            error: 'Amount and parcelId are required'
          });
        }

        // Validate amount (should be at least 50 cents for Stripe)
        if (amount < 50) {
          return res.status(400).send({
            error: 'Amount must be at least 50 cents'
          });
        }

        // Verify parcel exists
        const parcel = await parcelCollection.findOne({_id: new ObjectId(parcelId)});
        if (!parcel) {
          return res.status(404).send({
            error: 'Parcel not found'
          });
        }

        // Create payment intent (amount should already be in cents from frontend)
        const paymentIntent = await stripeInstance.paymentIntents.create({
          amount: amount, // Amount already in cents
          currency: 'usd',
          automatic_payment_methods: {
            enabled: true,
          },
          metadata: {
            parcelId: parcelId,
            parcelCost: parcel.cost
          }
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id
        });
      } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).send({
          error: 'Failed to create payment intent',
          details: error.message
        });
      }
    });

    // Stripe Webhook (Optional - for handling payment confirmations)
    app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
      const sig = req.headers['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.log('Webhook secret not configured');
        return res.status(200).send('Webhook secret not configured');
      }

      let event;

      try {
        event = stripeInstance.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err) {
        console.log(`Webhook signature verification failed.`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // Handle the event
      switch (event.type) {
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object;
          console.log('Payment succeeded:', paymentIntent.id);
          
          // Update parcel status if needed
          if (paymentIntent.metadata.parcelId) {
            try {
              // Get parcel information
              const parcel = await parcelCollection.findOne({_id: new ObjectId(paymentIntent.metadata.parcelId)});
              
              if (parcel) {
                // Store payment history in paymentCollection if not already stored
                const existingPayment = await paymentCollection.findOne({paymentIntentId: paymentIntent.id});
                
                if (!existingPayment) {
                  const paymentRecord = {
                    parcelId: paymentIntent.metadata.parcelId,
                    parcelTrackingNumber: parcel.trackingNumber,
                    userEmail: parcel.userEmail,
                    paymentIntentId: paymentIntent.id,
                    paymentAmount: paymentIntent.metadata.parcelCost,
                    paymentDate: new Date().toISOString(),
                    paymentStatus: 'confirmed',
                    parcelTitle: parcel.title,
                    senderName: parcel.senderName,
                    receiverName: parcel.receiverName,
                    senderRegion: parcel.senderRegion,
                    receiverRegion: parcel.receiverRegion,
                    createdAt: new Date().toISOString(),
                    source: 'webhook'
                  };

                  await paymentCollection.insertOne(paymentRecord);
                }

                // Update parcel status
                await parcelCollection.updateOne(
                  { _id: new ObjectId(paymentIntent.metadata.parcelId) },
                  { 
                    $set: { 
                      status: 'paid',
                      paymentStatus: 'confirmed',
                      stripePaymentIntentId: paymentIntent.id,
                      webhookConfirmedAt: new Date().toISOString()
                    } 
                  }
                );
              }
            } catch (error) {
              console.error('Error updating parcel after webhook:', error);
            }
          }
          break;
        
        case 'payment_intent.payment_failed':
          const failedPayment = event.data.object;
          console.log('Payment failed:', failedPayment.id);
          break;
        
        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      res.status(200).send('Webhook received');
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("ProFast Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
