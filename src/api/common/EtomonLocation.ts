import {BinaryEncoding, HashAlgorithm, IDFormat, SerializationFormat} from "@znetstar/encode-tools/lib/EncodeTools";
import {EncodingOptions} from "@znetstar/encode-tools/lib/IEncodeTools";

export enum GeoJSONLocationType {
    point = 'Point'
}

export interface GeoJSONLocation {
    type: GeoJSONLocationType.point;
  /**
   * Geographic coordinates to search within
   */
    coordinates: GeoJSONCoordinates;
}

export interface GeoJSONQuery {
  /**
   * Geographic coordinates to search within
   */
    coordinates:GeoJSONCoordinates;
  /**
   * Minimum distance to search within, as a radius from `coordinates` in meters.
   */
  minDistance: number;
  /**
   * Maximum distance to search within, as a radius from `coordinates` in meters.
   */
    maxDistance: number;
}

/**
 * Result from the Google Autocomplete API
 */
export interface AutocompleteResult {
  /**
   * Google Place ID of the result
   */
  place_id: string;
  /**
   * Plain-worded human readable description of the result
   */
  description: string;
}

/**
 * Query for the Google Autocomplete API
 *
 * See the Google documentation for more info: https://zb.gy/Ayxh
 */
export interface AutocompleteQuery {
  /**
   * Keyword to search using
   */
  input?: string,
  /**
   * Google API Key
   * See the Google documentation for more info: https://zb.gy/Ayxh
   */
  key?: string,
  /**
   * See the Google documentation for more info: https://zb.gy/Ayxh
   */
  sessiontoken?: string,
  /**
   * See the Google documentation for more info: https://zb.gy/Ayxh
   */
  // @ts-ignore
  types?: any,//string|{ region?: string },
  /**
   * Point to search for results within. Useful to differentiate "Venice, California" from "Venice, Florida" or "Venice, Italy"
   */
  location?: string,
  /**
   * See the Google documentation for more info: https://zb.gy/Ayxh
   */
  region?: string;
  /**
   * All additional fields to be passed as a query string to the Google Autocomplete API
   *
   * See the Google documentation for more info: https://zb.gy/Ayxh
   */
  [name: string]: string|undefined;
}

/**
 *
 */
export type ValueOrNegate<T> = T|{ $ne: T };

/**
 * Base object containing fields used in both the location queries and results.
 */
export interface EtomonLocationBase {
  /**
   * Either a Google Place ID or the hash of an IP Address, both representing a unique identifier for the location
   */
  id?: string;
  /**
   * Either a Google Place ID or the hash of an IP Address, both representing a unique identifier for the location
   */
  _id?: string;
  /**
   * Either the locality (like "New York City") or sublocality (like "Brooklyn") of the result, prefers the broadest
   * option ("New York City" over "Brooklyn").
   */
  locality?: string;
  /**
   * The highest level of sub-national division.
   *
   * This differs based on the country. For a federation like the United States it would be a state (like "California"),
   * in a union of countries, like the United Kingdom, it might be a country (like "England").
   */
  administrativeLevel1?: string;
  /**
   * The second-highest level of sub-national division.
   *
   * This differs based on the country. In the United States or United Kingdom, this would be a county (like "Richmond
   * County" or "Hampshire", for the US and UK, respectively).
   *
   * For small sovereign states, this might not exist (like "Singapore").
   */
  administrativeLevel2?: string;
  /**
   * The two digit ISO 3166-1 alpha-2 country code matching the location
   */
  country?: string;
  fromCache?: boolean;
}

/**
 * Fields that will be used in the query against the various location APIs
 */
export type EtomonLocationQuery = EtomonLocationBase&{
    /**
     * A point (as geographic) to search around, with a minimum and maximum distance from that point in meters.
     */
    location?: GeoJSONQuery,
    /**
     * See the Google documentation for more info: https://zb.gy/Ayxh
     */
    region?: string;
    /**
     * A human-readable address to search from (like "1 River Avenue, Bronx, New York").
     */
    address?: string;
    /**
     * An IP Address to obtain results from using the Maxmind GeoIP database.
    */
    ipAddress?: string;
    /**
     * If the `EtomonLocation` results obtained from IP Addresses should also be sent to the Google Places API for more
     * data.
     *
     * If the GeoIP function is used on all guest users to the website, this may save money.
     */
    resolveIpWithGeo?: boolean;
}

export type EtomonLocation = EtomonLocationBase&{
  /**
   * The exact geographic coordinates of the location.
   */
  location?: GeoJSONLocation,
  /**
   * The TZ Data timezone of the location.
   */
    timezone?: string;
  /**
   * The human-readable address of the location (like "New York, NY").
   */
    address?: string;
    /**
     * The English names of the most commonly spoken languages at the location.
     */
    languages?: string[];
    /**
     * The ITU-T E.123 calling code (like "+86") of the county.
     */
    phoneCode?: string;
    /**
     * The English name of the country.
     */
    countryName?: string;
  /**
   * Like the `address` field, but prefers the left-most components available, and strips out
   * ultra-specific details about the address.
   *
   * So "Bronx, New York, USA" over "1 River Avenue, Bronx, New York, New York, USA".
   */
    safeLabel?: string;
}

/**
 * Returns a result similar to the `EtomonLocation.address` field, but prefers the left-most components available, and strips out
 * ultra-specific details about the address.
 *
 *
 * So "Bronx, New York, USA" over "1 River Avenue, Bronx, New York, New York, USA".
 *
 * @param location Object to extract data from
 */
export function LabelLocation(location: EtomonLocation): string {
    const parts = [
        // City or County
        (location.locality || location.administrativeLevel2),
        // State
        (location.administrativeLevel1),
        // Country
        location.countryName
    ].filter(Boolean);

    if (parts.length > 0) {
        return parts.join(', ');
    }

    return (location && location.address) ? location.address : null;
}

/**
 * Returns the result of `LabelLoation` or an empty string.
 *
 * @param location Object to extract data from
 */
export function LabelLocationSafe(location: EtomonLocation): string {
    return LabelLocation(location) || "";
}

/**
 * Longitude and Latitude
 */
export type GeoJSONCoordinates = [ longitude: number, latitude: number ];

export const defaultEncodingOptions: EncodingOptions = {
  uniqueIdFormat: IDFormat.uuidv4,
  binaryEncoding: BinaryEncoding.nodeBuffer,
  hashAlgorithm: HashAlgorithm.xxhash64,
  serializationFormat: SerializationFormat.msgpack
};
