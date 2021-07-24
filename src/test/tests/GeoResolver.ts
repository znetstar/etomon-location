import {defaultGeoResolverOptions, defaultResolvePriorities, GeoResolver} from '../../api/server/GeoResolver';
import {createRouter} from '../../api/server/routes';
import getPort from 'get-port';
import express, {query} from 'express';
import {assert} from 'chai';
import Chance from 'chance';
import * as _ from 'lodash';
import * as fs from 'fs-extra';
const similarity = require('similarity');
import {
  EtomonLocation,
  GeoJSONCoordinates,
  GeoJSONLocation,
  LabelLocationSafe
} from "../../api/common/EtomonLocation";
import {EncodeToolsAuto} from "@etomon/encode-tools";
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

let port: number;
let server: any;
let resolver: GeoResolver;
let chance: Chance.Chance;


beforeEach(async function () {
  port = await getPort();
  resolver = new GeoResolver(googleApiKey, geoPath);
  chance = new Chance();
});

afterEach(async function () {

})

describe('GeoResolver', async function () {
  describe('resolvePriority', async function () {
    it(`should equal the same list provided in the constructor`, async function () {
      const priorities = chance.shuffle(defaultResolvePriorities.slice(0))
      resolver = new GeoResolver(googleApiKey, geoPath, {
        ...defaultGeoResolverOptions,
        resolvePriority: priorities
      });
      assert.deepEqual(
        resolver.resolvePriority,
        priorities
      )
    })
  });
  describe('geoJSONFromLatLng', async function () {
   it('should return a GeoJSONLocation object with the same input coordinates', async function () {
     const { location: loc } = randomLocation();
     const objIn: GeoJSONCoordinates = loc.coordinates;
     const objOut: GeoJSONLocation = loc;

     assert.deepEqual(
       GeoResolver.geoJSONFromLatLng(objIn),
       objOut
     );
   })
  });

  describe('locationFromQuery', async function () {
    it('should return a EtomonLocation object from an EtomonLocationQuery', async function () {
      const { query, location } = randomLocationQueryPair();

      location.id = location._id;
      (query as any).id = query._id;
      delete query.region;
      // delete query.id;
      delete location.languages;
      delete location.phoneCode;
      delete location.timezone;
      const outLoc = GeoResolver.locationFromQuery(query);
      delete (outLoc as any).safeLabel;
      delete location.safeLabel

      // @ts-ignore
      delete location.index;
      // @ts-ignore
      delete query.index;


      assert.deepEqual(outLoc, location);
    });

    it('should return a EtomonLocation object from an EtomonLocation', async function () {
      const { query, location } = randomLocationQueryPair();

      assert.deepEqual(GeoResolver.locationFromQuery(location), location);
    });

    it('should return null from null', async function () {
      assert.isNull(GeoResolver.locationFromQuery(null));
    });
  });
  describe('queryFromLocation', async function () {
    it('should return a EtomonLocationQuery object from an EtomonLocation', async function () {
      const { query, location } = randomLocationQueryPair();

      delete query.ipAddress;
      // @ts-ignore
      delete query.index;
      // @ts-ignore
      delete query.index;
      const outQ = GeoResolver.queryFromLocation(location);

      // @ts-ignore
      delete outQ.id;
      // @ts-ignore
      delete query.id;
      delete outQ.ipAddress;

      query.location.maxDistance = outQ.location.maxDistance = 0;
      query.location.minDistance = outQ.location.minDistance = 0;

      assert.deepEqual(outQ, query);
    });

    it('should return a EtomonLocationQuery object from an EtomonLocationQuery', async function () {
      const { query, location } = randomLocationQueryPair();

      const outQ = GeoResolver.queryFromLocation(query);
      delete outQ.ipAddress;
      delete query.ipAddress;

      query.location.maxDistance = outQ.location.maxDistance = 0;
      query.location.minDistance = outQ.location.minDistance = 0;
      // @ts-ignore
      delete outQ.id;
      // @ts-ignore
      delete query.id;

      assert.deepEqual(outQ, query);
    });

    it('should return null from null', async function () {
      assert.isNull(GeoResolver.queryFromLocation(null));
    });
  });

  describe('assembleAddressComponents', async function () {
    this.retries(5);
    it('should return the address components given a EtomonLocationQuery', async function () {
      const query = randomQuery();
      const comps = resolver.assembleAddressComponents(query);

      assert.equal(comps.get('locality'), query.locality);
      assert.equal(comps.get('administrative_area_level_2'), query.administrativeLevel2);
      assert.equal(comps.get('administrative_area_level_1'), query.administrativeLevel1);
      assert.equal(comps.get('country'), query.country);
    });

    it('should return the address components given a EtomonLocation', async function () {
      const location = randomLocation();
      const comps = resolver.assembleAddressComponents(location);

      assert.equal(comps.get('locality'), location.locality);
      assert.equal(comps.get('administrative_area_level_2'), location.administrativeLevel2);
      assert.equal(comps.get('administrative_area_level_1'), location.administrativeLevel1);
      assert.equal(comps.get('country'), location.country);
    });
  });

  describe('getTimezone', async function () {
    this.retries(5);
    it('should return the timezone given a EtomonLocationQuery', async function () {
      const { query, location } = randomLocationQueryPair();
      delete (query as any).timezone;
      const {timezone} = await resolver.getTimezone(query, (
        chance.timestamp()
      ));

      assert.equal(timezone, location.timezone);
    });

    it('should return the timezone given a EtomonLocation', async function () {

      const { location } = randomLocationQueryPair();

      const {timezone} = await resolver.getTimezone({ ...location, timezone: void(0) }, (
        chance.timestamp()
      ));

      assert.equal(timezone, location.timezone);
    });
  });

  describe('getCountryInfo', async function () {
    this.retries(5);
    it('should return country data given a EtomonLocationQuery', async function () {
      const { query, location } = randomLocationQueryPair();
      const { languages, phoneCode } = await resolver.getCountryInfo({
        ...query,
        languages: void(0),
        phoneCode: void(0)
      });

      assert.deepEqual([ languages, phoneCode ], [ location.languages, location.phoneCode ]);
    });

    it('should return the country data given a EtomonLocation', async function () {
      const { query, location } = randomLocationQueryPair();
      const { languages, phoneCode } = await resolver.getCountryInfo({
        ...location,
        languages: void(0),
        phoneCode: void(0)
      });

      assert.deepEqual([ languages, phoneCode ], [ location.languages, location.phoneCode ]);
    });
  });

  describe('resolveLocationByLatitudeAndLongitude', async function () {
    this.retries(5);
    it(`should be able to find at least one location matching the EtomonLocationQuery`, async function () {
      const { query, location } = randomLocationQueryPair();
      for await (const result of resolver.resolveLocationByLatitudeAndLongitude({ location: query.location })) {
        return;
      }

      assert.fail(`No matching results found`);
    });

    it(`should be able to find at least one location matching the EtomonLocationQuery within a ${meters}m distance from the query`, async function () {
      const { query, location } = randomLocationQueryPair();

      const latMin = ( (location.location.coordinates[1] - distance));
      const latMax = (  (location.location.coordinates[1] + distance));

      const lngMin = ((location.location.coordinates[0] - distance));
      const lngMax = ( (location.location.coordinates[0] + distance));


      for await (const result of resolver.resolveLocationByLatitudeAndLongitude({ location: query.location })) {
        const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${meters}m a greater distance away from the original query`;
        assert.isAbove(result.location.coordinates[0], lngMin, msg('longitude', 'less'));
        assert.isAbove(result.location.coordinates[1], latMin, msg('latitude', 'less'));

        assert.isBelow(result.location.coordinates[0], lngMax, msg('longitude', 'more'));
        assert.isBelow(result.location.coordinates[1], latMax, msg('latitude', 'more'));

      }
    });

    it(`should be able to find at least one location matching the EtomonLocation`, async function () {
      const { query, location } = randomLocationQueryPair();
      for await (const result of resolver.resolveLocationByLatitudeAndLongitude({ location: location.location })) {
        return;
      }

      assert.fail(`No matching results found`);
    });

    it(`should be able to find at least one location matching the EtomonLocation within a ${meters}m distance from the query`, async function () {
      const { query, location } = randomLocationQueryPair();



      const latMin = ( location.location.coordinates[1] - (location.location.coordinates[1] * distance));
      const latMax = ( location.location.coordinates[1] + (location.location.coordinates[1] * distance));

      const lngMin = ( location.location.coordinates[0] - (location.location.coordinates[0] * distance));
      const lngMax = ( location.location.coordinates[0] + (location.location.coordinates[0] * distance));

      for await (const result of resolver.resolveLocationByLatitudeAndLongitude({ location: location.location })) {
        const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${meters}m a greater distance away from the original query`;
        assert.isAbove(result.location.coordinates[0], lngMin, msg('longitude', 'less'));
        assert.isAbove(result.location.coordinates[1], latMin, msg('latitude', 'less'));

        assert.isBelow(result.location.coordinates[0], lngMax, msg('longitude', 'more'));
        assert.isBelow(result.location.coordinates[1], latMax, msg('latitude', 'more'));
      }
    });
  });

  describe('resolveLocationByAddress', async function () {
    this.retries(5);
    it(`should be able to find at least one address matching the EtomonLocationQuery`, async function () {
      const { query, location } = randomLocationQueryPair();
      for await (const result of resolver.resolveLocationByAddress({ address: query.address })) {
        return;
      }

      assert.fail(`No matching results found`);
    });

    it(`should be able to find at least one address matching the EtomonLocationQuery with a ${addressSimiliarty*100}% similarity to the original query`, async function () {
      const { query, location } = randomLocationQueryPair();


      for await (const result of resolver.resolveLocationByAddress({ address: query.address })) {
        const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${addressSimiliarty*100}% different the original query`;

        const [ a,b ] = [result, location].map((s: EtomonLocation) => LabelLocationSafe(s));
        assert.isAbove(similarity(a,b), addressSimiliarty, msg('address', 'less'));
      }
    });

    it(`should be able to find at least one address matching the EtomonLocation`, async function () {
      const { query, location } = randomLocationQueryPair();
      for await (const result of resolver.resolveLocationByAddress({ address: location.address })) {
        return;
      }

      assert.fail(`No matching results found`);
    });

    it(`should be able to find at least one address matching the EtomonLocationQuery with a ${addressSimiliarty*100}% similarity to the original query`, async function () {
      const { query, location } = randomLocationQueryPair();

      for await (const result of resolver.resolveLocationByAddress({ address: location.address })) {
        const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${addressSimiliarty*100}% different the original query`;

        const [ a,b ] = [result, location].map((s: EtomonLocation) => LabelLocationSafe(s));
        assert.isAbove(similarity(a,b), addressSimiliarty, msg('address', 'less'));
      }
    });
  });
  describe('resolveLocationByAddressComponents', async function () {
    this.retries(5);
    it(`should be able to find at least one address matching the EtomonLocationQuery`, async function () {
      const { query, location } = randomLocationQueryPair();
      for await (const result of resolver.resolveLocationByAddressComponents({
        administrativeLevel1: query.administrativeLevel1,
        administrativeLevel2: query.administrativeLevel2,
        locality: query.locality,
        country: query.country
      })) {
        return;
      }

      assert.fail(`No matching results found`);
    });

    it(`should be able to find at least one address matching the EtomonLocationQuery with a ${addressSimiliarty*100}% similarity to the original query`, async function () {
      const { query, location } = randomLocationQueryPair();

      for await (const result of resolver.resolveLocationByAddressComponents({
        administrativeLevel1: query.administrativeLevel1,
        administrativeLevel2: query.administrativeLevel2,
        locality: query.locality,
        country: query.country
      })) {
        const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${addressSimiliarty*100}% different the original query`;

        const [ a,b ] = [result, location].map((s: EtomonLocation) => LabelLocationSafe(s));
        assert.isAbove(similarity(a,b), addressSimiliarty, msg('address', 'less'));
      }
    });

    it(`should be able to find at least one address matching the EtomonLocation`, async function () {
      const { query, location } = randomLocationQueryPair();
      for await (const result of resolver.resolveLocationByAddressComponents({
        administrativeLevel1: location.administrativeLevel1,
        administrativeLevel2: location.administrativeLevel2,
        locality: location.locality,
        country: location.country
      })) {
        return;
      }

      assert.fail(`No matching results found`);
    });

    it(`should be able to find at least one address matching the EtomonLocationQuery with a ${addressSimiliarty*100}% similarity to the original query`, async function () {
      const { query, location } = randomLocationQueryPair();

      for await (const result of resolver.resolveLocationByAddressComponents({
        administrativeLevel1: location.administrativeLevel1,
        administrativeLevel2: location.administrativeLevel2,
        locality: location.locality,
        country: location.country
      })) {
        const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${addressSimiliarty*100}% different the original query`;

        const [ a,b ] = [result, location].map((s: EtomonLocation) => LabelLocationSafe(s));
        assert.isAbove(similarity(a,b), addressSimiliarty, msg('address', 'less'));
      }
    });
  });

  describe('resolveLocationByIpAddress', async function () {
    this.retries(5);
    it(`should be able to find at least one EtomonLocation matching the ip address`, async function () {
      for await (const result of resolver.resolveLocationByIpAddress({
        ipAddress: chance.ip()
      })) {
        assert.ok(result);
        assert.ok(result.location);
        assert.ok(result.location.coordinates);
        return;
      }

      assert.fail(`No matching results found`);
    });
  });

  describe('resolveLocation', async function () {
    this.retries(5);

    it(`should be able to find at least one EtomonLocation with the same fields as the EtomonLocationQuery, and within a ${meters}m distance from the query`, async function () {
      const { query, location } = randomLocationQueryPair();

      const latMin = ( location.location.coordinates[1] - (location.location.coordinates[1] * distance));
      const latMax = ( location.location.coordinates[1] + (location.location.coordinates[1] * distance));

      const lngMin = ( location.location.coordinates[0] - (location.location.coordinates[0] * distance));
      const lngMax = ( location.location.coordinates[0] + (location.location.coordinates[0] * distance));


      for await (const result of resolver.resolveLocation( {
        ...query,
        id: void(0),
        _id: void(0)
      } )) {
        const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${meters}m a greater distance away from the original query`;
        assert.isAbove(result.location.coordinates[0], lngMin, msg('longitude', 'less'));
        assert.isAbove(result.location.coordinates[1], latMin, msg('latitude', 'less'));

        assert.isBelow(result.location.coordinates[0], lngMax, msg('longitude', 'more'));
        assert.isBelow(result.location.coordinates[1], latMax, msg('latitude', 'more'));
      }
    });
    it(`should be able to find at least one EtomonLocation with the same fields as the EtomonLocation, and within a ${meters}m distance from the query`, async function () {
      const { query, location } = randomLocationQueryPair();

      const latMin = ( location.location.coordinates[1] - (location.location.coordinates[1] * distance));
      const latMax = ( location.location.coordinates[1] + (location.location.coordinates[1] * distance));

      const lngMin = ( location.location.coordinates[0] - (location.location.coordinates[0] * distance));
      const lngMax = ( location.location.coordinates[0] + (location.location.coordinates[0] * distance));


      for await (const result of resolver.resolveLocation( {
        ...location,
        id: void(0),
        _id: void(0)
      } )) {
        const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${meters}m a greater distance away from the original query`;
        assert.isAbove(result.location.coordinates[0], lngMin, msg('longitude', 'less'));
        assert.isAbove(result.location.coordinates[1], latMin, msg('latitude', 'less'));

        assert.isBelow(result.location.coordinates[0], lngMax, msg('longitude', 'more'));
        assert.isBelow(result.location.coordinates[1], latMax, msg('latitude', 'more'));
      }
    });
  });

  describe('resolveOneLocation', async function () {
    this.retries(5);

    it(`should be able to find at least one EtomonLocation with the same fields as the EtomonLocationQuery, and within a ${meters}m distance from the query`, async function () {
      const { query, location } = randomLocationQueryPair();

      const latMin = ( location.location.coordinates[1] - (location.location.coordinates[1] * distance));
      const latMax = ( location.location.coordinates[1] + (location.location.coordinates[1] * distance));

      const lngMin = ( location.location.coordinates[0] - (location.location.coordinates[0] * distance));
      const lngMax = ( location.location.coordinates[0] + (location.location.coordinates[0] * distance));


      const result = await resolver.resolveOneLocation( {
        ...query,
        id: void(0),
        _id: void(0)
      })
      const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${meters}m a greater distance away from the original query`;
      assert.isAbove(result.location.coordinates[0], lngMin, msg('longitude', 'less'));
      assert.isAbove(result.location.coordinates[1], latMin, msg('latitude', 'less'));

      assert.isBelow(result.location.coordinates[0], lngMax, msg('longitude', 'more'));
      assert.isBelow(result.location.coordinates[1], latMax, msg('latitude', 'more'));

    });
    it(`should be able to find at least one EtomonLocation with the same fields as the EtomonLocation, and within a ${meters}m distance from the query`, async function () {
      const { query, location } = randomLocationQueryPair();

      const latMin = ( location.location.coordinates[1] - (location.location.coordinates[1] * distance));
      const latMax = ( location.location.coordinates[1] + (location.location.coordinates[1] * distance));

      const lngMin = ( location.location.coordinates[0] - (location.location.coordinates[0] * distance));
      const lngMax = ( location.location.coordinates[0] + (location.location.coordinates[0] * distance));

      const result = await resolver.resolveOneLocation( {
        ...location,
        id: void(0),
        _id: void(0)
      })
      const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${meters}m a greater distance away from the original query`;
      assert.isAbove(result.location.coordinates[0], lngMin, msg('longitude', 'less'));
      assert.isAbove(result.location.coordinates[1], latMin, msg('latitude', 'less'));

      assert.isBelow(result.location.coordinates[0], lngMax, msg('longitude', 'more'));
      assert.isBelow(result.location.coordinates[1], latMax, msg('latitude', 'more'));
    });
  });

  describe('resolveLocations', async function () {
    this.retries(10);

    it(`should be able to find at least one EtomonLocation with the same fields as the EtomonLocationQuery, and within a ${meters}m distance from the query`, async function () {
      const { query, location } = randomLocationQueryPair();

      const latMin = ( location.location.coordinates[1] - (location.location.coordinates[1] * distance));
      const latMax = ( location.location.coordinates[1] + (location.location.coordinates[1] * distance));

      const lngMin = ( location.location.coordinates[0] - (location.location.coordinates[0] * distance));
      const lngMax = ( location.location.coordinates[0] + (location.location.coordinates[0] * distance));


      for await (const result of resolver.resolveLocations( {
        ...query,
        id: void(0),
        _id: void(0)
      } )) {
        if (
          result.location.coordinates[1] > latMin &&
          result.location.coordinates[0] > lngMin &&
          result.location.coordinates[1] < latMax &&
          result.location.coordinates[0] < lngMax
        ) {
          return;
        }
      }

      assert.fail(`No results found within a ${meters}m radius of the original query`);
    });
    it(`should be able to find at least one EtomonLocation with the same fields as the EtomonLocation, and within a ${meters}m distance from the query`, async function () {
      const { query, location } = randomLocationQueryPair();

      const latMin = ( location.location.coordinates[1] - (location.location.coordinates[1] * distance));
      const latMax = ( location.location.coordinates[1] + (location.location.coordinates[1] * distance));

      const lngMin = ( location.location.coordinates[0] - (location.location.coordinates[0] * distance));
      const lngMax = ( location.location.coordinates[0] + (location.location.coordinates[0] * distance));


      for await (const result of resolver.resolveLocations( {
        ...location,
        id: void(0),
        _id: void(0)
      } )) {
        if (
          result.location.coordinates[1] > latMin &&
          result.location.coordinates[0] > lngMin &&
          result.location.coordinates[1] < latMax &&
          result.location.coordinates[0] < lngMax
        ) {
          return;
        }
      }

      assert.fail(`No results found within a ${meters}m radius of the original query`);
    });
  });

  describe('autocompleteSearch', async function () {
    this.retries(5);

    it(`should be able to find at least one autocomplete entry with a ${addressSimiliarty*100}% similarity to the original query`, async function () {
      const { query, location } = randomLocationQueryPair();

      const autocompleteList = await resolver.autocompleteSearch({
        input: location.address
      });

      assert.ok(autocompleteList);
      assert.isAbove(autocompleteList.length, 0);

      const matches = autocompleteList.map((result) => {
        return similarity(result.description, (location.address));
      }).sort();

      matches.reverse();
      const msg = (x: string,y: string) =>  `Result ${x} is ${y} than ${addressSimiliarty*100}% different the original query`;

      assert.isAbove(matches[0], addressSimiliarty, msg('address', 'less'));
    });
  });

  describe('cache', async function () {
    it(`should be able to find a cached item`, async function () {
      const { query, location } = randomLocationQueryPair();

      const levelup = require('levelup');
      const memdown = require('memdown');
      const cache = levelup(memdown());

      delete query._id;

      const cacheKey = await resolver.cacheKey(query);
      assert.ok(cacheKey);

      resolver = new GeoResolver(googleApiKey, geoPath, {
        ...defaultGeoResolverOptions,
        cache
      });

      const list: EtomonLocation[] = [];

      for await (const ele of resolver.resolveLocations(query)) {
        list.push(ele);
      }

      const enc = new EncodeToolsAuto(defaultGeoResolverOptions.encodeOptions);

      const cachedListBuf = await cache.get(cacheKey);
      const cachedList = enc.deserializeObject<EtomonLocation[]>(cachedListBuf);

      assert.deepEqual(list, cachedList);
    });
  });
});
