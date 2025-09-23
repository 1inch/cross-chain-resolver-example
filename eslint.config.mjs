import oneInchEslintConfig from '@1inch/eslint-config'

export default [
    {
        ignores: ['contracts/lib/**', 'near/contracts/**/target/**', 'node_modules/**']
    },
    ...oneInchEslintConfig,
    {
        rules: {
            'no-console': 'off'
        },
        files: ['tests/**/**']
    }
]
