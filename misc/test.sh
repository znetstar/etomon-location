#!/bin/bash

set -e

GEO_IP_CITY_URI=${GEO_IP_CITY_URI:-https://public.zacharyboyd.nyc/geoip.7z}
export GEO_IP_CITY_PATH="$(pwd)/geoip/GeoLite2-City.mmdb"

if [ -z "$GEO_IP_CITY_PATH" ]; then
  curl -sL "$GEO_IP_CITY_URI" > ./geoip.7z
  7z x -p"$GEO_IP_CITY_PASSWORD" -aos  ./geoip.7z
fi

mocha -r ts-node/register --bail --timeout 0 --exit --ui bdd ./src/test/tests/*
