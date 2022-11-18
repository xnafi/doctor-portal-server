const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { c } = require('tar');
require('dotenv').config()
const app = express()
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
        const bookingsCollections = client.db('doctor_portal').collection('bookings')
        const usersCollections = client.db('doctor_portal').collection('users')


        app.get('/jwt', async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const exits = await usersCollections.findOne(query)
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
            const alreadyBooked = await bookingsCollections.find(bookingsQuery).toArray();

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
            const alreadyBooked = await bookingsCollections.find(query).toArray()

            if (alreadyBooked.length) {
                const message = `one book only in a day ${data.appointmentDate}`
                return res.send({ acknowledged: false, message })
            }
            const result = await bookingsCollections.insertOne(data)
            res.send(result)

        })
        app.get('/bookings', varifyToken, async (req, res) => {
            const email = req.query.email
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const emailQuery = { email: email }

            const result = await bookingsCollections.find(emailQuery).toArray()
            res.send(result)
        })
        app.post('/users', async (req, res) => {
            const user = req.body
            const result = await usersCollections.insertOne(user)
            console.log(result);
            res.send(result)
        })
        app.get('/users', async (req, res) => {
            const query = {}
            const result = await usersCollections.find(query).toArray()
            res.send(result)
        })
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollections.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })
        app.put('/users/admin/:id', varifyToken, async (req, res) => {
            const decodedEmail = req.decoded.email
            const filter = { email: decodedEmail }
            const user = await usersCollections.findOne(filter)
            if (user?.role !== 'admin') {
                return res.send('forbidden access')
            }
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const option = { upsert: true }
            const updateUser = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollections.updateOne(query, updateUser, option)
            res.send(result)
        })


    } catch (error) {
        console.log(err);
    }

}
run().catch(er => console.log(er))






app.listen(port, () => {
    console.log('api running on', port);
})