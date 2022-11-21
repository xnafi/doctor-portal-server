const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const app = express()
const stripe = require("stripe")(process.env.STRIPE_KEY);
const port = process.env.PORT || 5000

// middleware
app.use(cors())
app.use(express.json())


app.get('/', (req, res) => {
    res.send('hello from doctors portal')
})

function varifyToken(req, res, next) {
    const auth = req.headers.authorization
    if (!auth) {
        return res.status(401).send('unauthorize user access')
    }
    const token = auth.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            console.log(err);
            return res.status(403).send('forbidden access')

        }
        req.decoded = decoded;
        next()
    })


}
const uri = process.env.DB_URL;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const run = async () => {
    try {
        const appointmentOptions = client.db('doctor_portal').collection('appointmentOption')
        const bookingsCollection = client.db('doctor_portal').collection('bookings')
        const usersCollection = client.db('doctor_portal').collection('users')
        const doctorsCollection = client.db('doctor_portal').collection('doctors')
        const paymentsCollection = client.db('doctor_portal').collection('payments')


        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }
        app.get('/jwt', async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const exits = await usersCollection.findOne(query)
            if (exits) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1d' })
                return res.send({ accessToken: token })
            }
            res.status(403).send('forbidden access')

        })

        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date

            const bookingsQuery = { appointmentDate: date }
            const query = {}
            const options = await appointmentOptions.find(query).toArray();
            const alreadyBooked = await bookingsCollection.find(bookingsQuery).toArray();

            options.forEach(option => {
                // by this line will get which treatment has been booked
                const bookedOptions = alreadyBooked.filter(book => book.treatment === option.name)
                // by this line of code  will find which slot has been booked
                const bookedSlots = bookedOptions.map(book => book.slot)
                // by this line of code will find which slots need to remove from option
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots

            })
            res.send(options)

        })

        app.post('/bookings', async (req, res) => {
            const data = req.body
            const query = {
                email: data.email,
                appointmentDate: data.appointmentDate,
                treatment: data.treatment
            }
            const alreadyBooked = await bookingsCollection.find(query).toArray()

            if (alreadyBooked.length) {
                const message = `one book only in a day ${data.appointmentDate}`
                return res.send({ acknowledged: false, message })
            }
            const result = await bookingsCollection.insertOne(data)
            res.send(result)

        })
        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const result = await bookingsCollection.findOne(query)
            res.send(result)
        })
        // update payment
        app.post('/payments', async (req, res) => {
            const payment = req.body
            const result = await paymentsCollection.insertOne(payment)
            const bookingId = payment.id
            const query = { _id: ObjectId(bookingId) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transationId: payment.transationId
                }
            }
            const updateBooking = await bookingsCollection.updateOne(query, updatedDoc)

            res.send(result)
        })
        app.get('/bookings', varifyToken, async (req, res) => {
            const email = req.query.email
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const emailQuery = { email: email }

            const result = await bookingsCollection.find(emailQuery).toArray()
            res.send(result)
        })
        app.post('/users', async (req, res) => {
            const user = req.body
            const result = await usersCollection.insertOne(user)
            console.log(result);
            res.send(result)
        })
        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id
            const query = {_id : ObjectId(id)}
            const result = await usersCollection.deleteOne(query)
            console.log(result);
            res.send(result)
        })
        app.get('/users', async (req, res) => {
            const query = {}
            const result = await usersCollection.find(query).toArray()
            res.send(result)
        })
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })
        app.put('/users/admin/:id', varifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const option = { upsert: true }
            const updateUser = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(query, updateUser, option)
            res.send(result)
        })
        app.get('/doctors/speciality', async (req, res) => {
            const query = {}
            const result = await appointmentOptions.find(query).project({ name: 1 }).toArray()
            res.send(result)
        })
        app.get('/doctors', varifyToken, verifyAdmin, async (req, res) => {
            const query = {}
            const result = await doctorsCollection.find(query).toArray()
            res.send(result)
        })
        app.post('/doctors', varifyToken, verifyAdmin, async (req, res) => {
            const doctor = req.body
            const result = await doctorsCollection.insertOne(doctor)
            res.send(result)
        })
        app.delete('/doctors/:id', varifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const filter = { _id: ObjectId(id) }
            const result = await doctorsCollection.deleteOne(filter)
            res.send(result)
        })

        // stripe method

        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });


    } catch (error) {
        console.log(err);
    }

}
run().catch(er => console.log(er))






app.listen(port, () => {
    console.log('api running on', port);
})