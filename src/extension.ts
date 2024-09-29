'use strict';

import { ExtensionContext, languages, Hover, workspace } from 'vscode';
import * as input_handlers from './input_handlers';
import { fetch } from 'undici';

// this function will fetch the eth price in USD from coingecko
async function fetchEthPrice() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        const data = await response.json() as { ethereum: { usd: number } };
        const price = data.ethereum.usd;
        return price;
    } catch (error) {
        console.error('Error fetching ETH price:', error);
        return 0;
    }
}

// Create an object to hold the ethPrice
const ethPriceHolder = { current: 0 };

// Fetch immediately
fetchEthPrice().then(price => {
    ethPriceHolder.current = price;
});

// Then fetch every 5 minutes
const interval = setInterval(async () => {
    ethPriceHolder.current = await fetchEthPrice()
}, 1000 * 60 * 5);

export function activate(context: ExtensionContext) {
    const hover = languages.registerHoverProvider({scheme: '*', language: '*'}, {
        provideHover(document, position, token) {
            var word = document.getText(document.getWordRangeAtPosition(position));

            let inputDataTypes: string[] = workspace.getConfiguration('hexinspector').get('inputDataTypes');
            let forms: string[] = workspace.getConfiguration('hexinspector').get('hoverContent');
            let endianness: string = workspace.getConfiguration('hexinspector').get('endianness');

            endianness = endianness.charAt(0).toUpperCase() + endianness.slice(1).toLowerCase() + ' Endian';

            if (inputDataTypes.length == 0 || forms.length == 0) {
                return undefined;
            }

            let bytes: Uint8Array;
            let formsMap: input_handlers.MapFormToFunction;

            for (let inputDataType of inputDataTypes) {
                let inputHandler = input_handlers.createInputHandler(inputDataType);
                if (!inputHandler)
                    continue;

                let parsed = inputHandler.parse(word);
                if (!parsed)
                    continue;

                bytes = inputHandler.convert(parsed, endianness == 'Little Endian');
                formsMap = inputHandler.getFormsMap();
            }

            function formatValue(value: number, decimals: number, allowTrailingZeros: boolean = false): string {
                if (value === 0) return '0';
                
                // Convert to string without exponential notation
                let result = Math.abs(value).toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 100 });
                
                // Ensure we have the correct number of decimal places
                let [intPart, fracPart = ''] = result.split('.');
                fracPart = fracPart.padEnd(decimals, '0').slice(0, decimals);
                
                result = intPart + (fracPart ? '.' + fracPart : '');
                
                // Remove trailing zeros after the decimal point
                if (!allowTrailingZeros) {
                    result = result.replace(/\.?0+$/, '');
                }
                
                // Remove decimal point if it's the last character
                result = result.replace(/\.$/, '');
                
                // Restore sign if negative
                if (value < 0) result = '-' + result;
                
                return result;
            }

            function bytesToDecimal(bytes: Uint8Array): number {
                const maybeNumber = parseFloat((formsMap.decimal?.(bytes) ?? word).replace(',', ''));
                if (!isNaN(maybeNumber)) {
                    return maybeNumber;
                }
            }

            let weiFormsMap: input_handlers.MapFormToFunction = {
                'gwei': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes)
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const gwei = maybeNumber / 1e9;
                    return formatValue(gwei, 9);
                },
                'ether': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes)
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const ether = maybeNumber / 1e18;
                    return formatValue(ether, 18);
                },
                'usd': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes)
                    if (maybeNumber === undefined) {
                        return '';
                    }

                    const ether = maybeNumber / 1e18;
                    const dollars = ether * ethPriceHolder.current
                    return '$' + formatValue(dollars, 2, true);
                }
            }

            let gweiFormsMap: input_handlers.MapFormToFunction = {
                'wei': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes)
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const wei = Math.round(maybeNumber * 1e9);
                    return formatValue(wei, 1);
                },
                'ether': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes)
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const ether = maybeNumber / 1e9;
                    return formatValue(ether, 18);
                },
                'usd': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes)
                    if (maybeNumber === undefined) {
                        return '';
                    }

                    const ether = maybeNumber / 1e9;
                    const dollars = ether * ethPriceHolder.current
                    return '$' + formatValue(dollars, 2, true);
                }
            }

            let etherFormsMap: input_handlers.MapFormToFunction = {
                'wei': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes)
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const wei = Math.round(maybeNumber * 1e18);
                    return formatValue(wei, 1);
                },
                'gwei': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes)
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const gwei = maybeNumber * 1e9;
                    return formatValue(gwei, 9);
                },
                'usd': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes)
                    if (maybeNumber === undefined) {
                        return '';
                    }

                    const dollars = maybeNumber * ethPriceHolder.current
                    return '$' + formatValue(dollars, 2, true);
                }
            }

            if (bytes) {
                let formMaxLength = 0;
                for (const form of [weiFormsMap, gweiFormsMap, etherFormsMap]) {
                    formMaxLength = Math.max(formMaxLength, ...Object.keys(form).map(key => key.length));
                }

                let message = 'EthConverter: ' + word + '\n';

                // wei conversions
                message += '\nWei\n';
                for (const [form, func] of Object.entries(weiFormsMap)) {
                    let result = func(bytes);
                    if (result == '') continue;
                    message += form.charAt(0).toUpperCase() + form.slice(1) + ':  ';
                    message += ' '.repeat(formMaxLength - form.length) + result + '\n';
                }

                // gwei conversions
                message += '\nGwei\n';
                for (const [form, func] of Object.entries(gweiFormsMap)) {
                    let result = func(bytes);
                    if (result == '') continue;
                    message += form.charAt(0).toUpperCase() + form.slice(1) + ':  ';
                    message += ' '.repeat(formMaxLength - form.length) + result + '\n';
                }

                // ether conversions
                message += '\nEther\n';
                for (const [form, func] of Object.entries(etherFormsMap)) {
                    let result = func(bytes);
                    if (result == '') continue;
                    message += form.charAt(0).toUpperCase() + form.slice(1) + ':  ';
                    message += ' '.repeat(formMaxLength - form.length) + result + '\n';
                }

                // message = (formsMap.decimal?.(bytes) ?? word);

                return new Hover({language: 'hexinspector', value: message});
            }
        }
    });

    if (hover) {
        context.subscriptions.push(hover);
    }
}

export function deactivate() {
    clearInterval(interval);
}
