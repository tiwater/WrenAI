/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const withLess = require('next-with-less');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const resolveAlias = {
  antd$: path.resolve(__dirname, 'src/import/antd'),
};

/** @type {import('next').NextConfig} */
const nextConfig = withLess({
  output: 'standalone',
  staticPageGenerationTimeout: 1000,
  transpilePackages: [
    '@ant-design/icons-svg',
    '@ant-design/icons', 
    'rc-util',
    'rc-pagination',
    'rc-picker',
    'rc-tree',
    'rc-table'
  ],
  compiler: {
    // Enables the styled-components SWC transform
    styledComponents: {
      displayName: true,
      ssr: true,
    },
  },
  lessLoaderOptions: {
    additionalData: `@import "@/styles/antd-variables.less";`,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...resolveAlias,
    };
    return config;
  },
  // routes redirect
  async redirects() {
    return [
      {
        source: '/setup',
        destination: '/setup/connection',
        permanent: true,
      },
    ];
  },

	async headers() {
		const frameAncestors =
			process.env.WREN_UI_EMBED_FRAME_ANCESTORS || '*';

		return [
			{
				source: '/embed/:path*',
				headers: [
					{
						key: 'Content-Security-Policy',
						value: `frame-ancestors ${frameAncestors};`,
					},
				],
			},
		];
	},
});

module.exports = withBundleAnalyzer(nextConfig);
