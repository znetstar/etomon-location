import {Server as RPCServer} from 'multi-rpc';
import { ExpressTransport } from 'multi-rpc-express-transport';
import GeoResolver from './GeoResolver';
import {
  AutocompleteQuery,
  AutocompleteResult,
  defaultEncodingOptions,
  EtomonLocation,
  EtomonLocationQuery
} from '../common/EtomonLocation';
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
 * Accepts input in the form of a `EtomonLocationQuery` and returns matching `EtomonLocation`s.
 */
export interface IGeoRPCHandler {
  /**
   * Uses the Google Autocomplete API to return autocomplete matches.
   * @param result
   */
  autocompleteSearch(query: AutocompleteQuery): Promise<AutocompleteResult[]>;
  /**
   * Returns all matching `EtomonLocation` objects from `resolveLocation`.
   * @param query
   */
  resolveLocations(query:EtomonLocationQuery): Promise<EtomonLocation[]>;
  /**
   * Returns a single `EtomonLocation` object from `resolveLocation`.
   * @param query
   */
  resolveOneLocation(query:EtomonLocationQuery): Promise<EtomonLocation>;
}

/**
 * Accepts input in the form of a `EtomonLocationQuery` and returns matching `EtomonLocation`s.
 */
export class GeoRPCHandler implements  IGeoRPCHandler {
  /**
   * The underlying GeoResolver to use
   * @param geo
   */
  constructor(protected geo: GeoResolver) {}


  autocompleteSearch = async (query: AutocompleteQuery) => {
    const results = await this.geo.autocompleteSearch(query);
    return results;
  }

  resolveLocations = async (query:EtomonLocationQuery) => {
    const results = [];
    for await (const ele of (this.geo.resolveLocations(query))) {
      results.push((ele as any));
    }
    return results;
  }

  resolveOneLocation = async (query:EtomonLocationQuery) => {
    for await (const ele of (this.geo.resolveLocations(query))) {
      return ele;
    }
  }

  public get methodHost(): IGeoRPCHandler {
    return {
      autocompleteSearch: this.autocompleteSearch,
      resolveLocations: this.resolveLocations,
      resolveOneLocation: this.resolveOneLocation
    }
  }
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
export function createRouter(geo: GeoResolver) {
  const router = require('express').Router();

  const transport = new ExpressTransport(new EncodeToolsSerializer(defaultEncodingOptions), /*rpcRouter*/router);
  const handler = new GeoRPCHandler(geo);
  const methods: IGeoRPCHandler&{ [name: string]: Function } = handler.methodHost as IGeoRPCHandler&{ [name: string]: Function };
  const rpc = new RPCServer(transport, methods);

  return { router, rpc, handler };
}


export default createRouter;
