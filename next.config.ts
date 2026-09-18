import type {NextConfig} from 'next';

const config:NextConfig={
  reactStrictMode:true,
  async redirects(){
    return [{source:'/a/:id/accept',destination:'/a/:id/baseline',permanent:false}];
  },
};

export default config;
