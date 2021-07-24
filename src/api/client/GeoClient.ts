import {
  AutocompleteQuery,
  AutocompleteResult,
  defaultEncodingOptions,
  EtomonLocation,
  EtomonLocationQuery
} from '../common/EtomonLocation';
import IGeoClient from './IGeoClient';
import {
  Client as RPCClient,
  EncodeToolsSerializer,
  HTTPClientTransport, Transport
} from 'multi-rpc-browser';
import {EncodingOptions} from "@etomon/encode-tools/lib/IEncodeTools";
import {EtomonLocationQueryOrResult} from "../server/GeoResolver";

export class GeoClient implements IGeoClient {
  protected rpcClient: RPCClient;
  protected rpcTransport: Transport;

  /**
   * @param baseUrl Base URL to the location RPC service
   * @param encodingOptions Serialization options for communication with the RPC Server
   */
  constructor(baseUrl: string, encodingOptions?: EncodingOptions);
  /**
   * @param rpcClient Multi-RPC Client connection to the RPC service
   */
  constructor(rpcClient: RPCClient);
  constructor(protected connection: string|RPCClient, encodingOptions: EncodingOptions = defaultEncodingOptions) {
    if (typeof(connection) === 'string') {
      this.rpcTransport = new HTTPClientTransport(
        new EncodeToolsSerializer(encodingOptions),
        connection
      );
      this.rpcClient = new RPCClient(this.rpcTransport);
    } else {
      this.rpcClient = connection;
      this.rpcTransport = connection.transport;
    }
  }

  /**
   * Reads a `EtomonLocation` object from `localStorage`
   * @param collection
   */
  public static readLocationFromCookie(collection: string): EtomonLocation {
        if (typeof(document) !== 'undefined') {
           let cookie: string = (window).localStorage.getItem('location');
            if (cookie) {
                let groups: { [name: string]: any } = JSON.parse(cookie);
                return groups[collection] || null;
            }
        }
        return null;
    }

  /**
   * Ensures that `EtomonLocation` objects are returned.
   * @param locDoc Existing location object
   * @param resolveResults Whether to update fields on the location object with fields from the location api
   */
    public async ensureLocation(locDoc: EtomonLocation, resolveResults?: boolean): Promise<EtomonLocation[]>;
  /**
   * Ensures that `EtomonLocation` objects are returned given a Google Autocomplete entry
   * @param searchResult Google Autocomplete object
   * @param resolveResults Whether to update fields on the location object with fields from the location api
   */
    public async ensureLocation(searchResult: AutocompleteResult, resolveResults?: boolean): Promise<EtomonLocation[]>;
  /**
   * Ensures that `EtomonLocation` objects are returned given a Google Place ID
   * @param placeId
   * @param resolveResults Whether to update fields on the location object with fields from the location api
   */
    public async ensureLocation(placeId: string, resolveResults: boolean): Promise<EtomonLocation[]> ;
  /**
   * Ensures that `EtomonLocation` objects are returned given an array of `AutocompleteResult` entries, place ids, and/or `EtomonLocations`.
   * @param inputs  Array of `AutocompleteResult` entries, place ids, and/or `EtomonLocation`s
   * @param resolveResults Whether to update fields on the location object with fields from the location api
   */
    public async ensureLocation(inputs: Array<AutocompleteResult|string|EtomonLocation>, resolveResults?: boolean): Promise<EtomonLocation[]> ;
  /**
   * Ensures that `EtomonLocation` objects are returned given an array of `AutocompleteResult` entries, place ids, and/or `EtomonLocations`.
   * @param inputs  Array of `AutocompleteResult` entries, place ids, and/or `EtomonLocation`s
   * @param resolveResults Whether to update fields on the location object with fields from the location api
   */
    public async ensureLocation(inputs: AutocompleteResult|string|EtomonLocation|(Array<AutocompleteResult|string|EtomonLocation>), resolveResults: boolean = false): Promise<EtomonLocation[]> {
        inputs = [].concat(inputs);
        let results: EtomonLocation[] = [];
        for (let input of inputs) {
            let result: EtomonLocation;
            if (typeof(input) === 'string') {
                result = await this.resolveOneLocation({ id: input });
            }
            else if (typeof(input) === 'object' && input && typeof((<any>input).place_id) !== 'undefined') {
                let searchResult = <AutocompleteResult>input;
                if (resolveResults) {
                    result = await this.resolveOneLocation(({ id: searchResult.place_id }));
                } else {
                    result = {
                        id: searchResult.place_id,
                        address: searchResult.description,
                        _id: searchResult.place_id
                    };
                }
            }
            else if (typeof(input) === 'object' && input && (typeof((<any>input).id) !== 'undefined' || typeof((<any>input)._id) !== 'undefined')) {
                result = <EtomonLocation>input;
                if (resolveResults) {
                    if(result.id){
                        result = await this.resolveOneLocation(({ id: result.id }));
                    }else if(result._id){
                        result = await this.resolveOneLocation(({ id: result._id }));
                    }
                }
            }

            if (result) {
                results.push(result);
            }
        }

        return results;
    }

  protected async makeRpcCall<T>(method: string, ...params: any[]): Promise<T> {
    return this.rpcClient.invoke(method, params);
  }

  public async resolveLocations(query:EtomonLocationQueryOrResult): Promise<EtomonLocation[]> {
    return this.makeRpcCall<EtomonLocation[]>('resolveLocations', query);
  }

  public async resolveOneLocation(query: EtomonLocationQueryOrResult): Promise<EtomonLocation> {
    return this.makeRpcCall<EtomonLocation>('resolveOneLocation', query);
  }

  public async autocompleteSearch(query: AutocompleteQuery, resolveResults: boolean = false): Promise<EtomonLocation[]> {
      const results = await this.makeRpcCall<AutocompleteResult[]>('autocompleteSearch', query);
      return this.ensureLocation(results, resolveResults);
  }
}

export default GeoClient;
