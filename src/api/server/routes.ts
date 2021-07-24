import { Router } from 'express';
import * as bodyParser from 'body-parser';
import {Server as RPCServer, JSONSerializer} from 'multi-rpc';
import { ExpressTransport } from 'multi-rpc-express-transport';
import GeoResolver from './GeoResolver';
import {AutocompleteQuery, defaultEncodingOptions, EtomonLocation, EtomonLocationQuery} from '../common/EtomonLocation';
import {EncodeToolsSerializer} from "multi-rpc-browser";

function asyncMiddleware(fn: Function) {
  return (req: any, res: any, next: any) => {
    const p = <Promise<any>>fn(req, res);

    p.then((result) => {
      if (typeof(result) !== 'undefined')
        next(result === true ? void(0) : result);
    }, (err) => {
      err.url = req.url;
      next(err);
    });
  }
}

export interface RouterOptions {
  defaultRequestBodyLimit: number;
}

/**
 * Creates a series of express routes given a `GeoResolver`.
 *
 * Exposes a REST interface (example, `GET: /?address=New%20York`) and a
 * JSON RPC 2.0 interface at (`POST: /rpc`).
 *
 * The RPC interface exposes `resolveLocations`, `resolveLocation` and `autcompleteSearch`.
 * Where as the REST interface only exposes `resolveLocations`, `resolveLocation`, the latter of which
 * takes a Google Place ID as the sole parameter (`/:googlePlaceId`).
 * @param geo
 */
export function createRouter(geo: GeoResolver, options: RouterOptions = { defaultRequestBodyLimit: 10e3 }) {
  const router = Router();
 /* router.use(bodyParser.json({ type: 'application/json',  limit: options.defaultRequestBodyLimit  }));

  async function locationsGetHeadRoute(req: any, res: any): Promise<any> {
    const isHead = req.method.toLowerCase() === 'head',
      isGet = req.method.toLowerCase() === 'get';

    // This is only for GET and HEAD requests
    if (!isHead && !isGet) {
      return true;
    }

    const query: any = {};

    if (typeof (req.query.id) !== 'undefined') {
      query.id = query.id || [];
      query.id = String(req.query.id);
    }

    if (typeof (req.query.ipAddress) !== 'undefined') {
      query.ipAddress = String(req.query.ipAddress);
    }

    if (typeof (req.query.latitude) !== 'undefined') {
      query.location = query.location || {};
      query.location.coordinates = query.location.coordinates || [];
      query.location.coordinates[1] = Number(req.query.latitude);
    }

    if (typeof (req.query.longitude) !== 'undefined') {
      query.location = query.location || {};
      query.location.coordinates = query.location.coordinates || [];
      query.location.coordinates[0] = Number(req.query.longitude);
    }

    if (typeof (req.query.maxDistance) !== 'undefined') {
      query.location = query.location || {};
      query.location.maxDistance = Number(req.query.maxDistance);
    }

    if (typeof (req.query.minDistance) !== 'undefined') {
      query.location = query.location || {};
      query.location.minDistance = Number(req.query.minDistance);
    }

    if (typeof (req.query.locality) !== 'undefined') {
      query.locality = String(req.query.locality);
    }

    if (typeof (req.query.administrativeLevel1) !== 'undefined') {
      query.administrativeLevel1 = String(req.query.administrativeLevel1);
    }

    if (typeof (req.query.administrativeLevel2) !== 'undefined') {
      query.administrativeLevel2 = String(req.query.administrativeLevel2);
    }

    if (typeof (req.query.country) !== 'undefined') {
      query.country = String(req.query.country || 0);
    }

    if (typeof (req.query.region) !== 'undefined') {
      query.region = String(req.query.region);
    }

    if (typeof (req.query.address) !== 'undefined') {
      query.address = String(req.query.address);
    }

    if (typeof (req.query.fromCache) !== 'undefined') {
      query.fromCache = (req.query.fromCache === '0') ? false : (req.query.fromCache === '1' ? true : void (0));
    }

    if (typeof (req.query.resolveIpWithGeo) !== 'undefined') {
      query.resolveIpWithGeo = (req.query.resolveIpWithGeo === '0') ? false : (req.query.resolveIpWithGeo === '1' ? true : void (0));
    }


    const results: EtomonLocation[] = [];
    for await (const ele of (await geo.resolveLocations(query))) {
      results.push((ele));
    }

    if (isGet) {
      res.status(200);
      res.set('content-type', 'application/json');
      res.send(results);
    } else {
      res.status(200);
      res.set('content-type', 'application/json');
      res.set('x-etomon-count', results.length);
      return;
    }

  }

  async function locationsGetGetHeadRoute(req: any, res: any): Promise<any> {
    const isHead = req.method.toLowerCase() === 'head',
      isGet = req.method.toLowerCase() === 'get';

    // This is only for GET and HEAD requests
    if (!isHead && !isGet) {
      return true;
    }

    let query: EtomonLocationQuery = {id: req.params.id};
    const location = GeoResolver.locationFromQuery(await geo.resolveOneLocation(query));

    if (!location) {
      res.status(404).send('');
      return;
    }

    if (!location) {
      res.status(404).send('');
      return;
    }

    if (isGet) {
      res.status(200);
      res.set('content-type', 'application/json');
      res.send(location);
    } else {
      res.status(200);
      res.set('content-type', 'application/json');
      return;
    }
  }*/

  /*const rpcRouter = Router();*/
  const transport = new ExpressTransport(new EncodeToolsSerializer(defaultEncodingOptions), /*rpcRouter*/router);
  const rpc = new RPCServer(transport, {
    autocompleteSearch: async function (query: AutocompleteQuery) {
      const results = await geo.autocompleteSearch(query);
      return results;
    },
    resolveLocations: async function (query:EtomonLocationQuery) {
      try {
        const results = [];
        for await (const ele of (geo.resolveLocations(query))) {
          results.push((ele as any));
        }
        return results;
      } catch (err) {
        debugger
      }
    },
    resolveOneLocation: async function (query:EtomonLocationQuery) {
      try {
        for await (const ele of (geo.resolveLocations(query))) {
          return ele;
        }
      } catch (err) {
        debugger
      }
    }
  });
  /*


  router.use('/', asyncMiddleware(locationsGetHeadRoute));
  router.post('/rpc', rpcRouter);
  router.use('/:id', asyncMiddleware(locationsGetGetHeadRoute));

  router.use('/', (req: any, res: any) => {
    res.status(405)
    res.set('allow', 'GET HEAD');
    res.send('');
  });

  router.use('/rpc', (req: any, res: any) => {
    res.status(405)
    res.set('allow', 'POST');
    res.send('');
  });


  router.use('/:id', (req: any, res: any) => {
    res.status(405)
    res.set('allow', 'GET HEAD');
    res.send('');
  });*/

  return { router, rpc };
}


export default createRouter;
