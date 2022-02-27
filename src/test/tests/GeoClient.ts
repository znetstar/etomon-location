import {defaultGeoResolverOptions, defaultResolvePriorities, GeoResolver} from '../../api/server/GeoResolver';
import {createRouter} from '../../api/server/routes';
import getPort from 'get-port';
import express from 'express';
import { Server as HTTPServer } from 'http';
import {assert} from 'chai';
import Chance from 'chance';
import * as _ from 'lodash';
import * as fs from 'fs-extra';
const similarity = require('similarity');
import {
  AutocompleteResult,
  EtomonLocation,
  GeoJSONCoordinates,
  GeoJSONLocation,
  LabelLocationSafe
} from "../../api/common/EtomonLocation";
import {
  addressSimiliarty,
  distance,
  geoPath,
  googleApiKey,
  meters,
  randomLocation,
  randomLocationQueryPair,
  randomQuery
} from "../testCommon";
import GeoClient from "../../api/client/GeoClient";
import {Server} from "http";

let port: number;
let server: any;
let resolver: GeoResolver;
let chance: Chance.Chance;
let geoClient: GeoClient;
let httpServer: HTTPServer;

beforeEach(async function () {
  port = await getPort();
  server = express();
  httpServer = new HTTPServer(server);
  resolver = new GeoResolver(googleApiKey, geoPath);

  const { rpc, router } =  await createRouter(resolver);

  server.use('/location', router);
  httpServer.listen(port);

  geoClient = new GeoClient(`http://127.0.0.1:${port}/location`);

  chance = new Chance();
});

afterEach(async function () {
  httpServer.close()
})

describe('GeoClient', async function () {
  describe('ensureLocation', async function (){

   for (const resolve of [ true, false ]) {
     it('should return an `EtomonLocation` given a '+ (!resolve ? 'full' : 'partial') +' `EtomonLocation`', async function () {
       this.retries(5);
       const { query } = randomLocationQueryPair();

       const location = await resolver.resolveOneLocation(query);

       const [location2] = await geoClient.ensureLocation(resolve ? { _id: location._id } : location, resolve);
       assert.equal(location2._id, location._id);
     });

     it('should return an `EtomonLocation` given a '+ (!resolve ? 'full' : 'partial') +' `AutocompleteResult`', async function () {
       this.retries(5);
       const { query } = randomLocationQueryPair();

       const location = await resolver.resolveOneLocation(query);

       const [autocompleteResult] = await resolver.autocompleteSearch({ input: location.address });
       const [location2] = await geoClient.ensureLocation([resolve ? { _id: autocompleteResult.place_id } : autocompleteResult], resolve);
       if (resolve) {
         assert.isAbove(similarity(LabelLocationSafe(location2), LabelLocationSafe(location)), 0.25);
       }
       // else {
         assert.ok(autocompleteResult);
         assert.ok(location2);
       // }
     });

     it('should return an `EtomonLocation` given a '+ (!resolve ? 'full' : 'partial') +' `place_id`', async function () {
       const { query } = randomLocationQueryPair();

       const location = await resolver.resolveOneLocation(query);
       const [location2] = await geoClient.ensureLocation([ location._id ], resolve);
       assert.equal(location2._id, location._id);
     });
   }
  });

  describe('resolveLocations', async function () {
    this.retries(5);
    it('results should match the partial input query', async function () {
      const { query } = randomLocationQueryPair();

      const results = await geoClient.resolveLocations( { country: query.country } );

      for (const result of results) {
        assert.equal(result.country, query.country);
      }
    });

    it('results should match the full input query', async function () {
      const { query } = randomLocationQueryPair();

      const location = await resolver.resolveOneLocation(query);
      const results = await geoClient.resolveLocations({ _id: location._id });
      assert.isTrue(
        results.map(r => r._id).includes(location._id)
      )
    });
  });
  describe('resolveOneLocation', async function () {
    this.retries(5);
    it('results should match the partial input query', async function () {
      const { query } = randomLocationQueryPair();

      const result = await geoClient.resolveOneLocation( { country: query.country } );
      assert.equal(result.country, query.country);
    });

    it('results should match the full input query', async function () {
      const { query } = randomLocationQueryPair();

      const location = await resolver.resolveOneLocation(query);
      const result = await geoClient.resolveOneLocation(location);
      assert.equal(result._id, location._id);
    });
  });
});
