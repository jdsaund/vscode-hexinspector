'use strict';

import { ExtensionContext, languages, Hover, workspace } from 'vscode';
import * as input_handlers from './input_handlers';
import { fetch } from 'undici';
import { BigNumber } from 'bignumber.js';

const WAD = new BigNumber('1e18');
const GWAD = new BigNumber('1e9');

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

            function formatValue(value: BigNumber, decimals: number, allowTrailingZeros: boolean = false): string {
                if (value.isZero()) return '0';
            
                let result = value.toFixed(decimals, BigNumber.ROUND_DOWN);
                
                if (!allowTrailingZeros) {
                    result = result.replace(/(\.\d*[1-9])0+$|\.0+$/, '$1');
                }
                
                result = result.replace(/\.$/, '');
                
                return result;
            }

            function bytesToDecimal(bytes: Uint8Array): BigNumber | undefined {
                const decimalString = formsMap.decimal?.(bytes) ?? word;
                const maybeNumber = new BigNumber(decimalString.replace(',', ''));
                if (!maybeNumber.isNaN()) {
                    return maybeNumber;
                }
            }

            let weiFormsMap: input_handlers.MapFormToFunction = {
                'gwei': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes);
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const gwei = maybeNumber.dividedBy(GWAD);
                    return formatValue(gwei, 9);
                },
                'ether': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes);
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const ether = maybeNumber.dividedBy(WAD);
                    return formatValue(ether, 18);
                },
                'usd': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes);
                    if (maybeNumber === undefined) {
                        return '';
                    }

                    const ether = maybeNumber.dividedBy(WAD);
                    const dollars = ether.multipliedBy(new BigNumber(ethPriceHolder.current));
                    return '$' + formatValue(dollars, 2, true);
                }
            }

            let gweiFormsMap: input_handlers.MapFormToFunction = {
                'wei': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes);
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const wei = maybeNumber.multipliedBy(GWAD).integerValue(BigNumber.ROUND_DOWN);
                    return formatValue(wei, 0);
                },
                'ether': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes);
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const ether = maybeNumber.dividedBy(GWAD);
                    return formatValue(ether, 18);
                },
                'usd': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes);
                    if (maybeNumber === undefined) {
                        return '';
                    }

                    const ether = maybeNumber.dividedBy(GWAD);
                    const dollars = ether.multipliedBy(new BigNumber(ethPriceHolder.current));
                    return '$' + formatValue(dollars, 2, true);
                }
            }

            let etherFormsMap: input_handlers.MapFormToFunction = {
                'wei': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes);
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const wei = maybeNumber.multipliedBy(WAD).integerValue(BigNumber.ROUND_DOWN);
                    return formatValue(wei, 0);
                },
                'gwei': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes);
                    if (maybeNumber === undefined) {
                        return '';
                    }
                    const gwei = maybeNumber.multipliedBy(GWAD);
                    return formatValue(gwei, 9);
                },
                'usd': (bytes: Uint8Array) => {
                    const maybeNumber = bytesToDecimal(bytes);
                    if (maybeNumber === undefined) {
                        return '';
                    }

                    const dollars = maybeNumber.multipliedBy(new BigNumber(ethPriceHolder.current));
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
