import * as fs from "fs-extra";
import * as _ from "lodash";
import {EtomonLocation, EtomonLocationQuery} from "../api/common/EtomonLocation";

export type IndexedLocation =  (EtomonLocation&{ index: number });
export type IndexedQuery =  (EtomonLocationQuery&{ index: number });

export const meters = 4828.03;
export const distance = ((meters /* in meters */)/1e3)/111.3;
export const addressSimiliarty = 0.75;

export const googleApiKey = process.env.GOOGLE_API_KEY;
export const geoPath = process.env.GEO_IP_CITY_PATH;

export const randomLocations: (IndexedLocation)[] = fs.readFileSync(require('path').join(__dirname, '..', '..', 'misc', 'test-locations.ldjson'), 'utf8')
  .split("\n")
  .slice(0, -1)
  .map((line: string, index: number) => {
    const o = ({ ...JSON.parse(line), index });
    for (let k in o) typeof(o[k]) === 'undefined' && delete o[k];
    return o;
  })
  .filter(f => Boolean(f));

export const randomQueries: IndexedQuery[] = fs.readFileSync(require('path').join(__dirname, '..', '..', 'misc', 'test-queries.ldjson'), 'utf8')
  .split("\n")  .slice(0, -1)
  .slice(0, -1)
  .map((line: string, index: number) => {
    const o = ({ ...JSON.parse(line), index });
    for (let k in o) typeof(o[k]) === 'undefined' && delete o[k];

    o.location.minDistance = 0;
    o.location.maxDistance = meters;
    delete o.id;

    return o;
  })
  .filter(f => Boolean(f));

export function randomLocation(): IndexedLocation {
  return _.sample(randomLocations) as IndexedLocation;
}
export function randomQuery(): IndexedQuery {
  return _.sample(randomQueries) as IndexedQuery;
}

export function randomLocationQueryPair(): { location: EtomonLocation, query: EtomonLocationQuery } {
  const location = _.cloneDeep(randomLocation());
  const query = _.cloneDeep(randomQueries[location.index]);

  delete location.index;
  delete query.index;

  return { location, query };
}
