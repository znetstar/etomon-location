import { EtomonLocationQuery, EtomonLocation  } from './EtomonLocation';

export default class LocationError extends Error {
    constructor(public location: EtomonLocation, message?: string|Error) {
        super(message ? ( message instanceof Error ? message.message : message ) : `An unknown error occurred with this location`);
        if (message instanceof Error) {
            this.innerError = message;
        }
    }

    public innerError: Error;

    public get code(): number {
        return 7000;
    }
    public get httpStatusCode(): number {
        return 500;
    }
}

export class LocationQueryError extends Error {
    constructor(public query: EtomonLocationQuery, message?: string|Error) {
        super(message ? ( message instanceof Error ? message.message : message ) : `An unknown error occurred with this location query`);
        if (message instanceof Error) {
            this.innerError = message;
        }
    }

    public innerError: Error;

    public get code(): number {
        return 7001;
    }
    public get httpStatusCode(): number {
        return 500;
    }
}

export class InvalidLocationQueryError extends LocationQueryError {
    constructor(public query: EtomonLocationQuery, message?: string|Error) {
        super(query, message ? message : `Location query is invalid`);
    }


    public get code(): number {
        return 7002;
    }
    public get httpStatusCode(): number {
        return 500;
    }
}
export class CouldNotResolveLocationError extends LocationQueryError {
    constructor(public query: EtomonLocationQuery, message?: string|Error) {
        super(query, message ? message : `Could not resolve the query provided to a location`);
    }

    public get code(): number {
        return 7003;
    }
    public get httpStatusCode(): number {
        return 404;
    }
}
