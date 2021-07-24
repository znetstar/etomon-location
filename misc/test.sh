#!/bin/bash

set -e

GEO_IP_CITY_URI=${GEO_IP_CITY_URI:-https://s3.amazonaws.com/assets.static.etomon.com/geoip.7z}

if [ -z "$GEO_IP_CITY_PATH" ]; then
  curl -sL "$GEO_IP_CITY_URI" > ./geoip.7z
  7z x -p"$GEO_IP_CITY_PASSWORD" -aos  ./geoip.7z
fi

export GEO_IP_CITY_PATH="$(pwd)/geoip/GeoLite2-City.mmdb"

mocha -r ts-node/register --bail --timeout 0 --exit --ui bdd ../src/test/tests/*
