import {AutocompleteQuery, EtomonLocation, EtomonLocationQuery} from '../common/EtomonLocation';
import {AutocompleteResult} from "../common/EtomonLocation";
import {EtomonLocationQueryOrResult} from "../server/GeoResolver";

export interface IGeoClient {
  /**
   * Resolves `EtomonLocation` objects given a `EtomonLocationQuery`, returning all results found.
   * @param query
   */
    resolveLocations(query: EtomonLocationQueryOrResult): Promise<EtomonLocation[]>;
  /**
   * Resolves a single `EtomonLocation` object given a `EtomonLocationQuery`, returning the top result, as ordered be priority.
   * @param query
   */
    resolveOneLocation(query: EtomonLocationQueryOrResult): Promise<EtomonLocation>;
  /**
   * Returns all matching Google Autocomplete entries, given an input keyword
   * @param query The autocomplete query
   * @param resolveResults Whether to return `EtomonLocation` objects fully resolved, or just basic info.
   */
    autocompleteSearch(query: AutocompleteQuery, resolveResults?: boolean): Promise<EtomonLocation[]>;
}

export default IGeoClient;
