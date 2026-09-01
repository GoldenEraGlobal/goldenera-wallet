import { adapterOas } from '@kubb/adapter-oas'
import { pluginAxios } from '@kubb/plugin-axios'
import { pluginReactQuery, resolverReactQuery } from '@kubb/plugin-react-query'
import { pluginTs } from '@kubb/plugin-ts'
import { defineConfig } from 'kubb'

// Keep generation reproducible: update this snapshot deliberately alongside API changes.
export default defineConfig({
  root: '.',
  input: './openapi.json',
  adapter: adapterOas(),
  output: { path: './src/gen', clean: true, barrel: { type: 'named' } },
  plugins: [
    pluginTs({ output: { path: 'models', mode: 'directory' } }),
    pluginAxios({ output: { path: 'clients', mode: 'directory' }, baseURL: '/' }),
    pluginReactQuery({
      output: { path: 'hooks', mode: 'directory' },
      group: { type: 'tag' },
      client: 'axios',
      hooks: true,
      resolver: {
        query: {
          name(node) { return `${resolverReactQuery.query.name(node)}Hook` },
        },
        suspenseQuery: {
          name(node) { return `${resolverReactQuery.suspenseQuery.name(node)}Hook` },
        },
        mutation: {
          name(node) { return `${resolverReactQuery.mutation.name(node)}Hook` },
        },
      },
      queryKey({ node }) {
        return [
          JSON.stringify('v1'),
          `{ url: ${JSON.stringify(node.path)} }`,
          ...(node.parameters.some((parameter) => parameter.in === 'query')
            ? ['...(query ? [query] : [])'] : []),
        ]
      },
      suspense: {},
    }),
  ],
})
