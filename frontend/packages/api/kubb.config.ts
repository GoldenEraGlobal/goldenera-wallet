import { type UserConfig } from '@kubb/core'
import { pluginOas } from '@kubb/plugin-oas'
import { pluginReactQuery } from '@kubb/plugin-react-query'
import { QueryKey } from '@kubb/plugin-react-query/components'
import { pluginTs } from '@kubb/plugin-ts'

export const config: UserConfig = {
  root: '.',
  input: {
    path: 'http://localhost:8080/v3/api-docs',
  },
  output: {
    path: './src/gen',
    clean: true,
    extension: {
      '.ts': '',
    },
  },
  plugins: [
    pluginOas({ 
        generators: [],
        validate: false,
    }),
    pluginTs({
      output: {
        path: 'models',
      },
    }),
    pluginReactQuery({
      client: {
        importPath: '../../../client', 
      },
      transformers: {
        name: (name, type) => {
          if (type === 'file' || type === 'function') {
            return `${name}Hook`
          }
          return name
        },
      },
      output: {
        path: './hooks',
      },
      group: {
        type: 'tag',
      },
      queryKey(props) {
        const keys = QueryKey.getTransformer(props)
        return ['"v1"', ...keys]
      },
      suspense: {},
    }),
  ],
}

export default config
