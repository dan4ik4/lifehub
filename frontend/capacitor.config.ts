import type {CapacitorConfig} from '@capacitor/cli';
const config:CapacitorConfig={
  appId:'online.lifehapp.app',appName:'Life Hub',webDir:'dist',
  server:{androidScheme:'https'},
  plugins:{CapacitorHttp:{enabled:true}},
};
export default config;
