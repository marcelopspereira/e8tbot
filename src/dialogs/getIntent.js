'use strict';

const builder = require('botbuilder');
const Promise = require('bluebird');
const MongoClient = Promise.promisifyAll(require('mongodb')).MongoClient;
//const shuffleArray = require('../lib/shuffleArray');
const sortArray = require('../lib/sortArray');
const createDeck = require('../lib/createDeck');

// Create LUIS recognizer that points at our model and add it as the root '/' dialog for our Cortana Bot.
const model = `https://api.projectoxford.ai/luis/v1/application?id=\
${process.env.LUIS_ID}&subscription-key=${process.env.LUIS_SUB_KEY}`;
const recognizer = new builder.LuisRecognizer(model);
const intents = new builder.IntentDialog({ recognizers: [recognizer] });

// Connect to MongoDB
const uri = process.env.MONGODB_URI;
const collection = process.env.MONGODB_COLLECTION;

const library = new builder.Library('getIntent');

// Intents Dialog
library.dialog('/', intents);

// Respond to answers like 'no', 'bye', 'goodbye', 'thank you'
intents.matches('SayBye', [
    (session, args) => {
        console.log('Ending conversation...');
        session.endConversation('Alright, let me know if you need anything else.');
    }
]);

// Respond to answers like 'i hate <food>', 'don't want to eat <food>'
intents.matches('SomethingElse', [
    (session, args) => {
        let task = builder.EntityRecognizer.findEntity(args.entities, 'Food');
        setTimeout(() => session.send(`Ah, something other than ${task.entity}?`), 2000);
        session.beginDialog('getIntent:/');
    }
]);

// Respond to answers like 'i want to eat <food>', '<food>', '<location>'
intents.matches('FindNearby', [
    (session, args) => {
        console.log('Success: Listening for Intent');
        // Food Queries TODO: support location & crawl/add props for menu items
        // FIXME: make failed search non-breaking
        let task = builder.EntityRecognizer.findEntity(args.entities, 'Food');
        try {
            session.send(`Searching for... ${task.entity}`);
        } catch (e) {
            session.send('Sorry, I couldn\'t find anything. Do you want to try something else?');
            session.beginDialog('getIntent:/');
        }

        // Parameterized query TODO: add validation for selector
        let selector = {
            'properties.name.0.text': {
                '$regex': `^.*${task.entity}.*$`,
                '$options': 'i'
            }
        }

        // Execute MongoDB query
        MongoClient.connectAsync(uri, collection, selector)
            .then((db) => {
                console.log('Success: Connected to MongoDB');
                return db.collection(collection).findAsync(selector);
            })
            .then((cursor) => {
                return cursor.toArrayAsync();
            })
            .then((docs) => {
                console.log('Success: Found the following records');
                console.log(docs);

                // End conversation if no results found
                if (docs.length === 0) {
                    console.log('Ending conversation...');
                    session.endConversation('Sorry, I couldn\'t find anything. We have to start over :(');
                }
                // REVIEW: how does haversine work if no origin?
                console.log(session.userData.location);
                return sortArray.byDistance(session, docs, sortArray.haversine);
            })
            .then((arr) => {
                // Create deck of cards
                let tmpDeck = [];
                createDeck(session, tmpDeck, arr, 5);

                // Show deck as a carousel
                let msg = new builder.Message(session)
                    .attachmentLayout(builder.AttachmentLayout.carousel)
                    .attachments(tmpDeck);
                console.log('Success: Carousel Created');
                session.send(msg);
            })
            .then(() => {
                console.log('Restarting dialog...');
                setTimeout(() => session.send('What else would you like to search for?'), 5000);
                session.beginDialog('getIntent:/');
            })
            .catch((err) => {
                console.log('Failure: Carousel not sent');
                throw err;
            });
    }

]);

// TODO: investigate why this doesnt handle defaults
intents.onDefault(builder.DialogAction.send("I'm sorry, I didn't quite get that."));

module.exports = library;
