const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require('stripe');

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
    // All API

    // Post API - Create a new parcel
    app.post('/parcels', async (req, res) => {
      try {
        const parcelData = req.body;
        const result = await parcelCollection.insertOne(parcelData);
        res.send(result);
      } catch (error) {
        res.status(500).send(error);
      }
    })

    // Get API - Fetch all parcel data of user
    app.get('/parcels' , async (req , res) => {
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
    app.delete('/parcels/:id' , async (req , res) => {
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

    // Get API - Fetch parcel data by id
    app.get('/parcels/:id' , async (req , res) => {
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
    app.patch('/parcels/:id/status', async (req, res) => {
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
    app.patch('/parcels/:id/payment', async (req, res) => {
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

    // Get API - Fetch payment history
    app.get('/payments', async (req, res) => {
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
    app.post('/create-payment-intent', async (req, res) => {
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
