/// <reference types="nativewind/types" />

/* NativeWind consumes global.css through the Metro transformer; TypeScript
   still needs to be told the side-effect import is legal. */
declare module "*.css";
