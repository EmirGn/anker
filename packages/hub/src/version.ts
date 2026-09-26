declare const __ANKER_VERSION__: string | undefined;
export const VERSION: string = typeof __ANKER_VERSION__ === 'string' ? __ANKER_VERSION__ : '0.0.0-dev';
