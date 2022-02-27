import {
  AutocompleteQuery,
  AutocompleteResult, defaultEncodingOptions,
  EtomonLocation,
  EtomonLocationQuery, GeoJSONCoordinates,
  GeoJSONLocation,
  GeoJSONLocationType
} from '../common/EtomonLocation';
import {CouldNotResolveLocationError, LocationQueryError} from '../common/LocationError';
import {byIso} from 'country-code-lookup';
import fetch from 'cross-fetch';
import {URL} from 'url';
import * as _ from 'lodash';
import {countryData, languageData} from '../common/CountryData';
import {Reader} from '@maxmind/geoip2-node';
import EncodeToolsNative, {
  BinaryEncoding,
  EncodeTools, EncodingOptions,
} from '@znetstar/encode-tools/lib/EncodeTools';
import ReaderModel from "@maxmind/geoip2-node/dist/src/readerModel";
import { LabelLocation, LabelLocationSafe } from "../common/EtomonLocation";
import { LevelUp } from 'levelup';


/**
 * The options for the order in which different strategies should be used to resolve the input to an `EtomonLocation`.
 */
export enum LocationResolvePriorities {
  /**
   * Resolve by ID (either Google Place ID) or hash of the IP Address
   */
  id = 'id',
  /**
   * Resolve by exact location (geographic coordinates).
   */
  location = 'location',
  /**
   * Resolve by Google Place ID.
   */
    googlePlaceId = 'googlePlaceId',
  /**
   * Resolve by address (all components)
   */
    address = 'address',
  /**
   * Resolve by locality (city/neighborhood)
   */
    locality = 'locality',
  /**
   * Resolve by admin level 1 (like England or California).
   */
    administrativeLevel1 = 'administrativeLevel1',
  /**
   * Resolve by admin level 2 (like Hampshire or San Mateo).
   */
    administrativeLevel2 = 'administrativeLevel2',
  /**
   * Resolve by country (like United Kingdom or United States)
   */
    country = 'country',
  /**
   * Resolve by IP Address
   */
    ipAddress = 'ipAddress'
}


export interface GeoResolverOptions {
  /**
   * Instance of LevelUp to be used a cache.
   * Using a cache with the Google Places API violates the Google Places Terms of Service
   */
  cache?: LevelUp;
  /**
   * The order in which different strategies should be used to resolve the input to an `EtomonLocation`.
   */
  resolvePriority: LocationResolvePriorities[];
  /**
   * Options to pass to the `EncodeTools` instance that will be used for object serialization (when the cache is used) and hashing.
   */
  encodeOptions: EncodingOptions;
}

export const defaultResolvePriorities = [
  LocationResolvePriorities.ipAddress,
  LocationResolvePriorities.id,
  LocationResolvePriorities.location,
  LocationResolvePriorities.googlePlaceId,
  LocationResolvePriorities.address,
  LocationResolvePriorities.locality,
  LocationResolvePriorities.administrativeLevel1,
  LocationResolvePriorities.administrativeLevel2,
  LocationResolvePriorities.country
];

export const defaultGeoResolverOptions: GeoResolverOptions = {
  resolvePriority: defaultResolvePriorities,
  encodeOptions: defaultEncodingOptions
};

  export type EtomonLocationQueryOrResult = EtomonLocation|EtomonLocationQuery;

/**
 * Accepts input in the form of a `EtomonLocationQuery` and returns matching `EtomonLocation`s.
 */
export class GeoResolver {
    protected encoder: EncodeTools;

  /**
   *
   * @param googleApiKey API Key for the Google Places, Autocomplete, and Geocoding APIs (API key must have accesse to all three).
   * @param pathToGeoIPCity Path to the Maxmind GeoIP City database.
   * @param options Extra options
   */
    constructor(public googleApiKey: string, public pathToGeoIPCity: string, public options: GeoResolverOptions = defaultGeoResolverOptions) {
      this.encoder = new EncodeTools(this.options.encodeOptions);
    }
    public get resolvePriority(): LocationResolvePriorities[] {
        return this.options.resolvePriority.slice(0);
    }

    protected geoipInstance: ReaderModel;

    protected async loadGeoIp(path: string = this.pathToGeoIPCity): Promise<ReaderModel> {
        if (this.geoipInstance) {
            return this.geoipInstance;
        }

        const geoipInstance = this.geoipInstance = await Reader.open(path);

        return geoipInstance;
    }

  /**
   * Returns a `GeoJSONLocation` given `GeoJSONCoordinates`
   * @param coordinates
   */
  public static geoJSONFromLatLng(coordinates: GeoJSONCoordinates): GeoJSONLocation {
        return {
            coordinates,
            type: GeoJSONLocationType.point
        };
    }

  /**
   * Processes the response of a Google API request, overlaying each result of the API response on top of the original
   * `EtomonLocationQueryOrResult`
   * @param $result Original `EtomonLocationQueryOrResult`
   * @param googleResponse The API response from Google
   */
    protected async* processGoogleResponse($result: EtomonLocationQueryOrResult, googleResponse: any): AsyncIterableIterator<EtomonLocation> {
        let query = this.queryFromLocation($result);
        let rawResults = (googleResponse && googleResponse.results);

        if (rawResults) {
            for (const rawResult of rawResults) {
                let result = _.cloneDeep($result);
                if (rawResult.geometry && rawResult.geometry.location && typeof(rawResult.geometry.location.lat) !== 'undefined'  && typeof(rawResult.geometry.location.lng) !== 'undefined') {
                    result = result || {};
                    result.location = result.location || GeoResolver.geoJSONFromLatLng([rawResult.geometry.location.lng, rawResult.geometry.location.lat]);
                } else {
                    throw new CouldNotResolveLocationError(query);
                }

                if (rawResult.formatted_address) {
                    result.address = rawResult.formatted_address;
                }

                if (rawResult.place_id) {
                    result.id = result._id = rawResult.place_id;
                }

                const components = rawResult.address_components;

                const adminLevelMap: Map<number, string> = new Map<number, string>();
                for (const component of components) {
                    // Locality (New York City) is preferred over sublocality (Brooklyn), but we'll take sublocality if we have to
                    if (component.types.includes('locality')) {
                        result.locality = component.long_name;
                        continue;
                    } else if (component.types.includes('sublocality') && !result.locality) {
                        result.locality = component.long_name;
                        continue;
                    }

                    let adminLevelStr: string = component.types.filter((t: any) => t.indexOf('administrative_area_level') !== -1)[0];
                    if (adminLevelStr) {
                        const adminLevel: number = Number(adminLevelStr.replace('administrative_area_level_', ''));
                        adminLevelMap.set(adminLevel, component.long_name);
                        continue;
                    }

                    if (component.types.includes('country')) {
                        result.country = component.short_name;
                        continue;
                    }
                }

                const lowestLevels = Array.from(adminLevelMap.keys()).sort().slice(0, 2);

                result.administrativeLevel1 = adminLevelMap.get(lowestLevels[0]);
                result.administrativeLevel2 = adminLevelMap.get(lowestLevels[1]);

                yield result as EtomonLocation;
            }
        }
    }

  /**
   * Returns a `EtomonLocation` given the information in an `EtomonLocationQuery`.
   * Missing fields are left null or undefined
   * @param query
   */
  public static locationFromQuery(query: EtomonLocationQuery): EtomonLocation;
  /**
   * Returns the `EtomonLocation` passed unchanged
   * @param location
   */
    public static locationFromQuery(location: EtomonLocation): EtomonLocation;
  /**
   * Returns a `EtomonLocation` given the information in an `EtomonLocationQuery`.
   * Missing fields are left null or undefined
   * @param input
   */
    public static locationFromQuery(input: EtomonLocationQueryOrResult): EtomonLocation;
  /**
   * Returns `null`
   * @param query
   */
    public static locationFromQuery(query: null): null;
  /**
   * Returns a `EtomonLocation` given the information in an `EtomonLocationQuery`.
   * Missing fields are left null or undefined
   * @param result
   */
    public static locationFromQuery(result: EtomonLocationQueryOrResult|null): EtomonLocation|null {
      if (!result) return null;
      let id = _.cloneDeep((<any>result).id);
      if ((<any>result).location) delete (<any>result).location.maxDistance;
      if ((<any>result).location) delete (<any>result).location.minDistance;
      // delete (<any>result)._id;
      // delete (<any>result).id;
      delete (<any>result).fromCache;
      delete (<any>result).ipAddress;
      delete (<any>result).resolveIpWithGeo;


    // (<any>result).safeLabel = (<any>result).address;
      try { (<any>result).safeLabel = LabelLocationSafe((<any>result)); }
      catch (err){ throw new LocationQueryError(GeoResolver.queryFromLocation(result), err.stack); }

      if ((<any>result).location) (<any>result).location.type = GeoJSONLocationType.point;

      result.id = id;

      return result as unknown as EtomonLocation;
    }

  /**
   * Returns a `EtomonLocationQuery` given the information in an `EtomonLocation`.
   * Missing fields are left null or undefined
   * @param location
   */
  public queryFromLocation(location: EtomonLocation): EtomonLocationQuery;
  /**
   * Returns the `EtomonLocationQuery` passed unchanged
   * @param location
   */
    public queryFromLocation(query: EtomonLocationQuery): EtomonLocationQuery;
  /**
   * Returns a `EtomonLocationQuery` given the information in an `EtomonLocation`.
   * Missing fields are left null or undefined
   * @param input
   */
    public queryFromLocation(input: EtomonLocationQueryOrResult): EtomonLocationQuery;
  /**
   * Returns `null`
   * @param query
   */
    public queryFromLocation(input: null): null;
  /**
   * Returns a `EtomonLocationQuery` given the information in an `EtomonLocation`.
   * Missing fields are left null or undefined
   * @param location
   */
    public queryFromLocation(location: EtomonLocationQueryOrResult|null): EtomonLocationQuery|null {
      return GeoResolver.queryFromLocation(location);
    }


  /**
   * Returns a `EtomonLocationQuery` given the information in an `EtomonLocation`.
   * Missing fields are left null or undefined
   * @param location
   */
  public static queryFromLocation(location: EtomonLocation): EtomonLocationQuery;
  /**
   * Returns the `EtomonLocationQuery` passed unchanged
   * @param location
   */
  public static queryFromLocation(query: EtomonLocationQuery): EtomonLocationQuery;
  /**
   * Returns a `EtomonLocationQuery` given the information in an `EtomonLocation`.
   * Missing fields are left null or undefined
   * @param input
   */
  public static queryFromLocation(input: EtomonLocationQueryOrResult): EtomonLocationQuery;
  /**
   * Returns `null`
   * @param query
   */
  public static queryFromLocation(input: null): null;
  /**
   * Returns a `EtomonLocationQuery` given the information in an `EtomonLocation`.
   * Missing fields are left null or undefined
   * @param location
   */
    public static queryFromLocation(location: EtomonLocationQueryOrResult|null): EtomonLocationQuery|null {
        if (!location) return null;
        const result = _.cloneDeep({
            administrativeLevel1: location.administrativeLevel1,
            administrativeLevel2: location.administrativeLevel2,
            country: location.country,
            locality: location.locality,
            address: location.address,
            ipAddress: (location as any).ipAddress,
            resolveIpWithGeo: typeof((location as any).resolveIpWithGeo) !== 'undefined' ? (location as any).resolveIpWithGeo : true,
            location: (location.location && location.location.coordinates) ? ({
                coordinates: location.location.coordinates,
                maxDistance: (<any>location).location.maxDistance || (location.location.coordinates ? 0 : void(0)),
                minDistance: (<any>location).location.minDistance || (location.location.coordinates ? 0 : void(0))
            }) : void(0),
            id: location._id || location.id,
            _id: location._id || location.id,
            region: (typeof(<EtomonLocationQuery>location).region) !== 'undefined' ? (<EtomonLocationQuery>location).region : (location.country ? (byIso(location.country as any) && byIso(location.country as any).internet) : void(0)),
        });

        for (let k in result) {
          // @ts-ignore
          if (typeof(result[k]) === 'undefined') delete result[k];
        }

        if (result.region)
            result.region = (result.region as any).toLowerCase();

        return result;
    }

  /**
   * Makes a request to a Google API
   * @param qs Query string to be used in the URL for the API request
   * @param query Query to be sent
   * @param api Which Google API to consume
   */
    protected async makeGoogleRequest(qs: { [name: string]: string }, query: EtomonLocationQuery, api: string = 'geocode'): Promise<unknown> {
        const url = new URL(`https://maps.googleapis.com/maps/api/${api}/json`);

        for (let k in qs) { url.searchParams.set(k, qs[k]); }
        url.searchParams.set('key', this.googleApiKey);

        const data = await (await fetch(url.href)).json();

        if (data.status !== 'OK') {
            throw new LocationQueryError(query, data.error_message || data.status);
        }

        return data;
    }

  /**
   * Returns a key-value pair of address components (for the Google Places API) from a `EtomonLocationQuery`.
   * @param query
   */
  public assembleAddressComponents(query: EtomonLocationQuery): Map<string, string>;
  /**
   * Returns a key-value pair of address components (for the Google Places API) from a `EtomonLocation`.
   * @param location
   */
    public assembleAddressComponents(location: EtomonLocation): Map<string, string>;
  /**
   * Returns a key-value pair of address components (for the Google Places API).
   * @param input
   */
    public assembleAddressComponents(input: EtomonLocationQueryOrResult): Map<string, string>;
  /**
   * Returns a key-value pair of address components (for the Google Places API).
   * @param input
   */
    public assembleAddressComponents(input: EtomonLocationQueryOrResult): Map<string, string> {
        const query = this.queryFromLocation(input);

        const result = new Map<string, any>();
        if (query.locality)
            result.set('locality', query.locality);
        if (query.administrativeLevel2)
            result.set('administrative_area_level_2', query.administrativeLevel2);
        if (query.administrativeLevel1)
            result.set('administrative_area_level_1', query.administrativeLevel1);
        if (query.country)
            result.set('country', query.country);

        return result;
    }

  /**
   * Obtains the timezone that corresponds to the location data provided, appending it to the `EtomonLocation` object.
   * @param query
   */
  public getTimezone(query: EtomonLocationQuery, timestamp?: number): Promise<EtomonLocation|null>;
  /**
   * Obtains the timezone that corresponds to the location data provided, appending it to the `EtomonLocation` object.
   * @param location
   */
  public getTimezone(location: EtomonLocation, timestamp?: number): Promise<EtomonLocation|null>;
  /**
   * Obtains the timezone that corresponds to the location data provided, appending it to the `EtomonLocation` object.
   * @param input
   */
  public getTimezone(input: EtomonLocationQueryOrResult, timestamp?: number): Promise<EtomonLocation|null>;
    public async getTimezone(result: EtomonLocationQueryOrResult, timestamp?: number): Promise<EtomonLocation|null> {
        const query = GeoResolver.queryFromLocation(result);
        try {
            const timezoneData: { timeZoneId?: string } = await this.makeGoogleRequest({
                location: `${query.location.coordinates[1]},${query.location.coordinates[0]}`,
                timestamp: (typeof(timestamp) === 'number' ? timestamp : Math.round((new Date()).getTime()/1e3))+''
            }, query, 'timezone');


            if (!timezoneData || !timezoneData.timeZoneId) {
                return null;
            }

            result = result || {};
            result.location = result.location || GeoResolver.geoJSONFromLatLng(query.location.coordinates);
            result.id = result.id || query.id;
            (<EtomonLocation>result).timezone =  timezoneData.timeZoneId;
            return <EtomonLocation>result;
        } catch (err) {
            throw new LocationQueryError(
                query,
                err
            );
        }
    }
  /**
   * Obtains arbitrary country data (like language and phone code) that corresponds to the location data provided, appending it to the `EtomonLocation` object.
   * @param query
   */
  public getCountryInfo(query: EtomonLocationQuery): EtomonLocation;
  /**
   * Obtains arbitrary country data (like language and phone code) that corresponds to the location data provided, appending it to the `EtomonLocation` object.
   * @param location
   */
  public getCountryInfo(location: EtomonLocation): EtomonLocation;
  /**
   * Obtains arbitrary country data (like language and phone code) that corresponds to the location data provided, appending it to the `EtomonLocation` object.
   * @param input
   */
  public getCountryInfo(input: EtomonLocationQueryOrResult): EtomonLocation;
  /**
   * Obtains arbitrary country data (like language and phone code) that corresponds to the location data provided, appending it to the `EtomonLocation` object.
   * @param result
   */
  public getCountryInfo(result: EtomonLocationQueryOrResult): EtomonLocation {
        const query = GeoResolver.queryFromLocation(result);
        try {
            const info: any = (<any>countryData)[(query.country as any)];
            result = result || {};
            result.location = result.location || GeoResolver.geoJSONFromLatLng(query.location.coordinates);
            result.id = result.id || query.id;
            (<EtomonLocation>result).languages = info.languages.map((s: string) => (<any>languageData)[s].name);
            (<EtomonLocation>result).phoneCode = info.phone;
            return <EtomonLocation>result;
        } catch (err) {
            throw new LocationQueryError(
                query,
                err
            );
        }
    }

  /**
   * Uses the geographic coordinates contained in the input object to find corresponding locations using the Google Places API
   * @param query
   */
    public resolveLocationByLatitudeAndLongitude(query: EtomonLocationQuery): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the geographic coordinates contained in the input object to find corresponding locations using the Google Places API
   * @param location
   */
    public resolveLocationByLatitudeAndLongitude(location: EtomonLocation): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the geographic coordinates contained in the input object to find corresponding locations using the Google Places API
   * @param input
   */
    public resolveLocationByLatitudeAndLongitude(input: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the geographic coordinates contained in the input object to find corresponding locations using the Google Places API
   * @param result
   */
    public async* resolveLocationByLatitudeAndLongitude(result: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation> {
        const query = GeoResolver.queryFromLocation(result);
        try {
            const geocodeData = await this.makeGoogleRequest({ latlng: `${query.location.coordinates[1]},${query.location.coordinates[0]}` }, query);

            for await (let result of this.processGoogleResponse(query, geocodeData))
              yield result;
        } catch (err) {
            throw new LocationQueryError(
                query,
                err
            );
        }
    }

  /**
   * Uses the address contained in the input object to find corresponding locations using the Google Places API
   * @param query
   */
      public resolveLocationByAddress(query: EtomonLocationQuery): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the address contained in the input object to find corresponding locations using the Google Places API
   * @param location
   */
      public resolveLocationByAddress(location: EtomonLocation): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the address contained in the input object to find corresponding locations using the Google Places API
   * @param input
   */
      public resolveLocationByAddress(input: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the address contained in the input object to find corresponding locations using the Google Places API
   * @param result
   */
      public async* resolveLocationByAddress(result: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation> {
        const query = GeoResolver.queryFromLocation(result);
        try {
            const q: any = {
                region: query.region,
                address: query.address
            };

            const geocodeData = await this.makeGoogleRequest(q, query);

            for await (const result of this.processGoogleResponse(query, geocodeData)) yield result;
        } catch (err) {
            throw new LocationQueryError(
                query,
                err
            );
        }
    }

  /**
   * Uses the Google Places API place id contained in the input object to find corresponding locations using the Google Places API
   * @param result
   */
    public resolveLocationByPlaceId(query: EtomonLocationQuery): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the Google Places API place id contained in the input object to find corresponding locations using the Google Places API
   * @param location
   */
    public resolveLocationByPlaceId(location: EtomonLocation): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the Google Places API place id contained in the input object to find corresponding locations using the Google Places API
   * @param input
   */
    public resolveLocationByPlaceId(input: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the Google Places API place id contained in the input object to find corresponding locations using the Google Places API
   * @param result
   */
    public async* resolveLocationByPlaceId(result: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation> {
        const query = GeoResolver.queryFromLocation(result);
        try {
            let q: any = {
                place_id: query._id || query.id
            };

            if (!q.place_id && query.region) {
              q.region = query.region;
              delete q.place_id;
            }

            const geocodeData = await this.makeGoogleRequest(q, query);

           for await (const result of this.processGoogleResponse(query, geocodeData)) yield result;
        } catch (err) {
            throw new LocationQueryError(
                query,
                err
            );
        }
    }


  /**
   * Uses the individual address components (like city or country) contained in the input object to find corresponding locations using the Google Places API
   * @param query
   */
    public resolveLocationByAddressComponents(query: EtomonLocationQuery): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the individual address components (like city or country) contained in the input object to find corresponding locations using the Google Places API
   * @param location
   */
    public resolveLocationByAddressComponents(location: EtomonLocation): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the individual address components (like city or country) contained in the input object to find corresponding locations using the Google Places API
   * @param input
   */
    public resolveLocationByAddressComponents(input: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the individual address components (like city or country) contained in the input object to find corresponding locations using the Google Places API
   * @param result
   */
    public async* resolveLocationByAddressComponents(result: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation> {
        const query = this.queryFromLocation(result);
        try {
            let components = await this.assembleAddressComponents(query);
            const q: any = {
                region: query.region
            };

            const c = [];
            for (let [key,value] of components) {
                c.push(`${key.indexOf('administrative_area') !== -1 ? 'administrative_area' : key}:${value.replace(/\s/ig, '+')}`);
            }

            q.components = c.join('|');

            const geocodeData = await this.makeGoogleRequest(q, query);

          for await (const result of this.processGoogleResponse(query, geocodeData)) yield result;
        } catch (err) {
            throw new LocationQueryError(
                query,
                err
            );
        }
    }

  /**
   * Uses the IP address contained in the input object to find corresponding locations using the Google Places API
   * @param query
   */
    public resolveLocationByIpAddress(query: EtomonLocationQuery): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the IP address contained in the input object to find corresponding locations using the Google Places API
   * @param location
   */
    public resolveLocationByIpAddress(location: EtomonLocation): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the IP address contained in the input object to find corresponding locations using the Google Places API
   * @param input
   */
    public resolveLocationByIpAddress(input: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation>;
  /**
   * Uses the IP address contained in the input object to find corresponding locations using the Google Places API
   * @param result
   */
    public async* resolveLocationByIpAddress(result: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation> {
        const query = GeoResolver.queryFromLocation(result);
        try {

            const output: EtomonLocation = result as EtomonLocation;
            const geoip = await this.loadGeoIp(this.pathToGeoIPCity);
            const geoRes = geoip.city(query.ipAddress as any);

            const lng = _.get(geoRes, 'location.longitude');
            const lat = _.get(geoRes, 'location.latitude');

            if (lng && lat) {
                output.location = {
                    coordinates: [lng, lat],
                    type: GeoJSONLocationType.point
                };
            }

            const timezone = _.get(geoRes, 'location.timezone');
            if (timezone) output.timezone = timezone;

            const country = _.get(geoRes, 'country.isoCode');
            if (country) output.country = country;
            let countryDataObj: any;
            if (country)
                countryDataObj = (countryData as any)[country];

            const countryName = _.get(countryDataObj, 'name');
            if (countryName) output.countryName = countryName;

            let languages;
            if (countryDataObj) {
                languages = [].concat(countryDataObj.languages).map(l => _.get((languageData as any)[l], 'name'));
            }
            if (!_.isEmpty(languages))
                output.languages = languages;

            const administrativeLevel1 = _.get(geoRes, 'subdivisions.0.names.en');
            if (administrativeLevel1) output.administrativeLevel1 = administrativeLevel1;
            const administrativeLevel2 = _.get(geoRes, 'subdivisions.1.names.en');
            if (administrativeLevel2) output.administrativeLevel2 = administrativeLevel2;
            const locality = _.get(geoRes, 'city.names.en');
            if (locality) output.locality = locality;

            const address = LabelLocation({
                locality,
                administrativeLevel1,
                administrativeLevel2,
                countryName
            });

            if (!_.isEmpty(address))
                output.address = address;

            output.id = output._id =  await this.cacheKey(query);
            yield output;
        } catch (err) {
            throw new LocationQueryError(
                query,
                err
            );
        }
    }
  /**
   * Creates a hash of the input object to be used as a cache key (if cache is enabled)
   * @param query
   */
  public cacheKey(query: EtomonLocationQuery): Promise<string>;
  /**
   * Creates a hash of the input object to be used as a cache key (if cache is enabled)
   * @param location
   */
  public cacheKey(location: EtomonLocation): Promise<string>;
  /**
   * Creates a hash of the input object to be used as a cache key (if cache is enabled)
   * @param input
   */
  public cacheKey(input: EtomonLocationQueryOrResult): Promise<string>;
  /**
   * Creates a hash of the input object to be used as a cache key (if cache is enabled)
   * @param input
   */
  public async cacheKey(input: EtomonLocationQueryOrResult): Promise<string> {
    let query = this.queryFromLocation(input);
    return this.encoder.encodeBuffer((await this.encoder.hashObject(query)), BinaryEncoding.base64).toString();
  }

  /**
   * Returns a single item from cache matching the provided query, if found
   * @param query
   */
  protected getLocationFromCache(query: EtomonLocationQuery): Promise<EtomonLocation>;
  /**
   * Returns a single item from cache matching the provided query, if found
   * @param location
   */
  protected getLocationFromCache(location: EtomonLocation): Promise<EtomonLocation>;
  /**
   * Returns a single item from cache matching the provided query, if found
   * @param input
   */
  protected getLocationFromCache(input: EtomonLocationQueryOrResult): Promise<EtomonLocation>;
  /**
   * Returns a single item from cache matching the provided query, if found
   * @param q
   */
  protected async getLocationFromCache(q: EtomonLocationQueryOrResult): Promise<EtomonLocation|null>  {
        return (await this.getLocationsFromCache(q))[0] || null;
    }

  /**
   * Returns all items from cache matching the provided query, if found
   * @param query
   */
  protected getLocationsFromCache(query: EtomonLocationQuery): Promise<EtomonLocation[]>;
  /**
   * Returns all items from cache matching the provided query, if found
   * @param location
   */
  protected getLocationsFromCache(location: EtomonLocation): Promise<EtomonLocation[]>;
  /**
   * Returns all items from cache matching the provided query, if found
   * @param input
   */
  protected getLocationsFromCache(input: EtomonLocationQueryOrResult): Promise<EtomonLocation[]>;
  /**
   * Returns all items from cache matching the provided query, if found
   * @param q
   */
  protected async getLocationsFromCache(q: EtomonLocationQueryOrResult): Promise<EtomonLocation[]> {
        let results: EtomonLocation[] = [];
        if (this.options.cache) {
          try {
            const key = await this.cacheKey(q);
            const cachedLocations = await this.options.cache.get(key);
            if (cachedLocations) {
              results = this.encoder.deserializeObject<EtomonLocation[]>(cachedLocations);
            }
          } catch (err) {
            if (!err.notFound) {
              throw err;
            }
          }
        }
        return results;
    }


  /**
   * Returns the count of items from cache matching the provided query, if found
   * @param query
   */
  protected getLocationsFromCacheCount(query: EtomonLocationQuery): Promise<number>;
  /**
   * Returns the count of items from cache matching the provided query, if found
   * @param location
   */
  protected getLocationsFromCacheCount(location: EtomonLocation): Promise<number>;
  /**
   * Returns the count of items from cache matching the provided query, if found
   * @param input
   */
  protected getLocationsFromCacheCount(input: EtomonLocationQueryOrResult): Promise<number>;
  /**
   * Returns the count of items from cache matching the provided query, if found
   * @param input
   */
  protected async getLocationsFromCacheCount(input: EtomonLocationQueryOrResult): Promise<number> {
      return (await this.getLocationsFromCache(input)).length;
    }


  /**
   * Loops through the list of `resolvePriorities` returning matching `EtomonLocation`s
   * @param query
   */
  public resolveLocation(query: EtomonLocationQuery):  AsyncGenerator<EtomonLocation>;
  /**
   * Loops through the list of `resolvePriorities` returning matching `EtomonLocation`s
   * @param location
   */
  public resolveLocation(location: EtomonLocation):  AsyncGenerator<EtomonLocation>;
  /**
   * Loops through the list of `resolvePriorities` returning matching `EtomonLocation`s
   * @param input
   */
  public resolveLocation(input: EtomonLocationQueryOrResult):  AsyncGenerator<EtomonLocation>;
  /**
   * Loops through the list of `resolvePriorities` returning matching `EtomonLocation`s
   * @param result
   */
  public async* resolveLocation(result: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation> {
        const query = GeoResolver.queryFromLocation(result);

        if (!query)
          return null;

        for (let priority of this.options.resolvePriority) {
            // We need ei
          // ther a valid value (like country) or the lat/lng before we can do anything
            if (!result.location && !query.ipAddress && !(<any>query)[priority]) {
                continue;
            }

            // By ID
            if (priority === LocationResolvePriorities.ipAddress && query.ipAddress && (query.id === result.id)) {
                for await (const location of this.resolveLocationByIpAddress(result)) {
                  yield location;
                }
                if (!query.resolveIpWithGeo)
                  break;
            }
            else if (priority === LocationResolvePriorities.id && query.id && (query.id === result.id)) {
                let q: any = {
                    '_id': query.id
                };

                if (await this.getLocationsFromCacheCount(q)) {
                    for (const loc of await this.getLocationsFromCache(q)) {
                      yield loc;
                    }
                    break;
                } else {
                  for await (const loc of this.resolveLocationByPlaceId(result)) {
                    yield loc;
                  }
                }
            }
            // By coordinates
            else if (priority === LocationResolvePriorities.location && query.location && query.location.coordinates && query.location.coordinates.length && (_.isEqual(result.location, query.location))) {
                const q = query;
                if (await this.getLocationsFromCacheCount(q)) {
                  for (const loc of await this.getLocationsFromCache(q)) {
                    yield loc;
                  }
                  break;
                } else {
                  for await (const loc of this.resolveLocationByLatitudeAndLongitude(result)) {
                    yield loc;
                  }
                }
            }
            // By coordinates
            else if (priority === LocationResolvePriorities.address && query.address && (result.address === query.address)) {
                const q: any = {
                    'address': query.address
                };

                if (await this.getLocationsFromCacheCount(q)) {
                  for (const loc of await this.getLocationsFromCache(q)) {
                    yield loc;
                  }
                  break;
                } else {
                  for await (const loc of this.resolveLocationByAddress(result)) {
                    yield loc;
                  }
                }
            }
            // By locality (city)
            else if (priority === LocationResolvePriorities.locality && query.locality && (result.locality === query.locality)) {
                const q: any = {
                    'locality': query.locality
                };

                if (query.administrativeLevel2) {
                    q['administrativeLevel2'] = query.administrativeLevel2;
                }

                if (query.administrativeLevel1) {
                    q['administrativeLevel1'] = query.administrativeLevel1;
                }

                if (query.country) {
                    q['country'] = query.country;
                }

                if (await this.getLocationsFromCacheCount(q)) {
                  for (const loc of await this.getLocationsFromCache(q)) {
                    yield loc;
                  }
                  break;
                } else {
                  for await (const loc of this.resolveLocationByAddressComponents(result)) {
                    yield loc;
                  }
                }
            }
            // By admin 2 (county)
            else if (priority === LocationResolvePriorities.administrativeLevel2 && query.administrativeLevel2 && (result.administrativeLevel2 === query.administrativeLevel2)) {
                const q: any = {
                    'administrativeLevel2': query.administrativeLevel2
                };

                if (query.administrativeLevel1) {
                    q['administrativeLevel1'] = query.administrativeLevel1;
                }

                if (query.country) {
                    q['country'] = query.country;
                }

                if (await this.getLocationsFromCacheCount(q)) {
                  for (const loc of await this.getLocationsFromCache(q)) {
                    yield loc;
                  }
                  break;
                } else {
                  for await (const loc of this.resolveLocationByAddressComponents(result)) {
                    yield loc;
                  }
                }
            }
            // By admin 1 (state/province )
            else if (priority === LocationResolvePriorities.administrativeLevel1 && query.administrativeLevel1 && (result.administrativeLevel1 === query.administrativeLevel1)) {
                const q: any = {
                    'administrativeLevel1': query.administrativeLevel1
                };

                if (query.country) {
                    q['country'] = query.country;
                }


              if (await this.getLocationsFromCacheCount(q)) {
                for (const loc of await this.getLocationsFromCache(q)) {
                  yield loc;
                }
                break;
              } else {
                for await (const loc of this.resolveLocationByAddressComponents(result)) {
                  yield loc;
                }
              }
            }
            // By country (city)
            else if (priority === LocationResolvePriorities.country && query.country && (result.country === query.country)) {
                const q: any = {
                    'country': query.country
                };

                if (await this.getLocationsFromCacheCount(q)) {
                  for (const loc of await this.getLocationsFromCache(q)) {
                    yield loc;
                  }
                  break;
                } else {
                  for await (const loc of this.resolveLocationByAddressComponents(result)) {
                    yield loc;
                  }
                }
            }
        }
        return null;
    }

  /**
   * Returns a single `EtomonLocation` object from `resolveLocation`.
   * @param query
   */
    public resolveOneLocation(query: EtomonLocationQuery): Promise<EtomonLocation|null>;
  /**
   * Returns a single `EtomonLocation` object from `resolveLocation`.
   * @param location
   */
    public resolveOneLocation(location: EtomonLocation): Promise<EtomonLocation|null>;
  /**
   * Returns a single `EtomonLocation` object from `resolveLocation`.
   * @param input
   */
    public resolveOneLocation(input: EtomonLocationQueryOrResult): Promise<EtomonLocation|null>;
  /**
   * Returns a single `EtomonLocation` object from `resolveLocation`.
   * @param result
   */
    public async resolveOneLocation(result: EtomonLocationQueryOrResult): Promise<EtomonLocation|null> {
        for await (const loc of this.resolveLocation(result)) {
          return loc;
        }
        return null;
    }

  /**
   * Uses the Google Autocomplete API to return autocomplete matches.
   * @param result
   */
    public async autocompleteSearch(query: AutocompleteQuery): Promise<AutocompleteResult[]> {
        query.key = this.googleApiKey;

        if (!query.input) return [];


        const url = new URL(`https://maps.googleapis.com/maps/api/place/autocomplete/json`);
        for (const k in query)
          url.searchParams.set(k, query[k]);

        const results = await (await fetch(url.href)).json();

        if (results.status && results.status !== 'OK') {
            throw new Error(results.status.error_message || results.status)
        }

        return results.predictions;
    }


  /**
   * Returns all matching `EtomonLocation` objects from `resolveLocation`.
   * @param query
   */
    public resolveLocations(query: EtomonLocationQuery): AsyncGenerator<EtomonLocation>;
  /**
   * Returns all matching `EtomonLocation` objects from `resolveLocation`.
   * @param location
   */
    public resolveLocations(location: EtomonLocation): AsyncGenerator<EtomonLocation>;
  /**
   * Returns all matching `EtomonLocation` objects from `resolveLocation`.
   * @param input
   */
    public resolveLocations(input: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation>;
  /**
   * Returns all matching `EtomonLocation` objects from `resolveLocation`.
   * @param result
   */
    public async* resolveLocations(result: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation> {
        const query = GeoResolver.queryFromLocation(result);
        let cacheKey;
        const useCache = Boolean(this.options.cache) && query.fromCache !== false;
        if (useCache) {
          cacheKey = await this.cacheKey(query);

          let cachedQueries: Buffer;
          try {
            cachedQueries = await this.options.cache.get(cacheKey);
          } catch (err) {
            if (!err.notFound) throw err;
          }

          if (cachedQueries) {
            const locations = this.encoder.deserializeObject<EtomonLocation[]>(cachedQueries);
            for (const loc of locations) {
              yield loc;
            }
            return;
          }
        }

        const results: Array<EtomonLocation> = [];
        for await (let location of this.resolveLocationsInner(query)) {
            results.push(location);
            yield location;
        }

        if (useCache) await this.options.cache.put(cacheKey, this.encoder.serializeObject<EtomonLocation[]>(results));
    }

  /**
   * Used internally to aggregate `EtomonLocation`s objects.
   * @param result
   */
    protected async* resolveLocationsInner (result: EtomonLocationQueryOrResult): AsyncGenerator<EtomonLocation> {
        const query = GeoResolver.queryFromLocation(result);

        const results = await this.resolveLocation(query);
        const basket = new Set();
        for await (let result of results) {
            if (!result)
                break;

            if (basket.has(result.id)) {
                continue;
            } else {
                basket.add(result.id);
            }

            try {
                if (typeof((<EtomonLocation>result).timezone) === 'undefined')
                    result = await this.getTimezone(result);
                if ([typeof((<EtomonLocation>result).languages), typeof((<EtomonLocation>result).phoneCode)].includes('undefined'))
                    result = this.getCountryInfo(result);

            } catch (err) { }


            yield GeoResolver.locationFromQuery(result);
        }
        return null;
    }
}

export default GeoResolver;
