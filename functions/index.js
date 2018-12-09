// Copyright 2017 Google Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
// admin.initializeApp(functions.config().firebase);
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

exports.five_min_tick = functions.pubsub
  .topic("five-min-tick")
  .onPublish(async message => {
    console.log("This job is run every 5 minutes!");
    var earthquakeData = await getEarthquakeData();
    var features = earthquakeData.features;
    console.log("Features: " + features);

    if (earthquakeData.metadata.count == 0) {
      return true;
    }

    // call function that returns a list of user identifiers to send alerts to (with alert information)
    // returns a map of user tokens and the respective earthquake data
    // var alertDict = await getNotificationData(features);

    await getNotificationData(features, alertDict => {
      if (alertDict === "error") {
        return false;
      }

      Object.keys(alertDict).forEach(function(key) {
        var listOfFeatures = alertDict[key];
        var title =
          listOfFeatures[0].properties.mag + " Magnitude Earthquake Near You";
        if (listOfFeatures.length > 1) {
          title = "Multiple Earthquakes in Your Area";
        }
        var body = "";

        for (var i = 0; i < listOfFeatures.length; i++) {
          body +=
            listOfFeatures[i].properties.mag +
            " mag earthquake near " +
            listOfFeatures[i].properties.place.substring(
              listOfFeatures[i].properties.place.indexOf("of")
            ) +
            "\n";
        }

        var payload = {
          notification: {
            title: title,
            body: body
          },
          token: key
        };
        sendPayload(payload);
      });
    });

    return true;
  });

async function getNotificationData(features, callback) {
  var db = admin.firestore();
  var hashmap = {};
  var querySnapshot = await db.collection("locations").get();
  console.log(querySnapshot);
  for (const doc of querySnapshot.docs) {
    var data = doc.data();
    var lat = data.latitude;
    var lon = data.longitude;
    var token = data.token;
    var maxDist = data.maxDist;
    var minMag = data.minMag;

    var sentESnap = await db.collection("sentEarthquakes").get();
    var sentEarthquakeCodes = [];
    for (const eDoc of sentESnap.docs) {
      sentEarthquakeCodes.push(eDoc.data().code);
    }

    for (const feature of features) {
      var g = feature.geometry.coordinates;
      var code = feature.properties.code;
      var dist = getDistanceFromLatLon(lat, lon, g[1], g[0]);
      if (dist <= (maxDist == undefined ? 200 : maxDist)) {
        console.log("first if");
        var hasNotBeenSent = await hasNotBeenSentToToken(db, code, token);
        if (
          !sentEarthquakeCodes.includes(code) &&
          hasNotBeenSent &&
          feature.properties.mag >= minMag
        ) {
          console.log("second if");
          if (hashmap[token] == undefined) {
            hashmap[token] = [];
          }
          hashmap[token].push(feature);
          saveEarthquakeCode(db, code, token);
        }
      }
    }
  }
  console.log("hashmap: ", hashmap);
  callback(hashmap);
}

function getEarthquakeData() {
  return new Promise(function(resolve) {
    axios
      .get(
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/1.0_hour.geojson"
      )
      .then(response => {
        var stringData = JSON.stringify(response.data);
        var data = response.data;
        console.log("data1: " + stringData);
        resolve(data);
      })
      .catch(error => {
        console.log(error);
        resolve("error");
      });
  });
}

function sendPayload(payload) {
  admin
    .messaging()
    .send(payload)
    .then(response => {
      console.log("Successfuly sent message: ", response);
    })
    .catch(error => {
      console.log("Error sending message", error);
    });
}

function saveEarthquakeCode(db, code, token) {
  db.collection("sentEarthquakes")
    .doc(code)
    .set({ code: code });
  db.collection("sentEarthquakes")
    .doc(code)
    .collection("sentTo")
    .doc(token)
    .set({ token: token });
}

async function hasNotBeenSentToToken(db, code, token) {
  var doc = await db
    .collection("sentEarthquakes")
    .doc(code)
    .get();

  if (!doc.exists) {
    return true;
  }

  db.collection("sentEarthquakes")
    .doc(code)
    .collection("sentTo")
    .get()
    .then(snapshot => {
      snapshot.forEach(function(doc) {
        if (doc.data["token"] === token) {
          return false;
        }
      });
      return true;
    });
}

function getDistanceFromLatLon(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(lat2 - lat1); // deg2rad below
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in km
  d *= 0.621371; // for miles
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}
