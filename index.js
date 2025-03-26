import { getRequestHeaders } from '../../../../script.js';
import { ToolManager } from '../../../tool-calling.js';
import { isValidUrl } from '../../../utils.js';

// --- Schemas ---

const getUserEnvironmentSchema = Object.freeze({
    '$schema': 'http://json-schema.org/draft-04/schema#',
    type: 'object',
    properties: {},
    required: []
});

const getYouTubeVideoScriptSchema = Object.freeze({
    $schema: 'http://json-schema.org/draft-04/schema#',
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL of the YouTube video.'
        },
    },
    required: [
        'url',
    ],
});

const visitLinksSchema = Object.freeze({
    '$schema': 'http://json-schema.org/draft-04/schema#',
    type: 'object',
    properties: {
        links: {
            type: 'array',
            items: {
                type: 'string',
                format: 'uri', // Indicate it should be a URL
            },
            description: 'An array of web links (URLs) to visit.',
            minItems: 1 // Require at least one link
        },
    },
    required: [
        'links',
    ],
});

// New schema for VisitLinksHtml - same as VisitLinksSchema
const visitLinksHtmlSchema = Object.freeze({
    '$schema': 'http://json-schema.org/draft-04/schema#',
    type: 'object',
    properties: {
        links: {
            type: 'array',
            items: {
                type: 'string',
                format: 'uri', // Indicate it should be a URL
            },
            description: 'An array of web links (URLs) to visit to get the HTML content.',
            minItems: 1
        },
    },
    required: [
        'links',
    ],
});


// --- Helper Functions ---

const parseId = (url) => {
    // If the URL is already an ID, return it
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
        return url;
    }

    const regex = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|&v(?:i)?=))([^#&?]*).*/;
    const match = url.match(regex);
    return (match?.length && match[1] ? match[1] : url);
};


// --- Tool Action Functions ---

function getUserEnvironment() {
    const dateTimeOptions = Intl.DateTimeFormat().resolvedOptions();
    const locale = localStorage.getItem('language') || dateTimeOptions.locale;
    const date = new Date();
    const timeZone = dateTimeOptions.timeZone;
    const localDate = date.toLocaleString(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const localTime = date.toLocaleString(locale, { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false });
    return { locale, localDate, localTime, timeZone };
}

async function getYouTubeVideoScript({ url }) {
    if (!url) throw new Error('URL is required');
    if (!isValidUrl(url)) throw new Error('Invalid URL');

    const id = parseId(url);
    const result = await fetch('/api/search/transcript', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ id, lang: '', json: true }),
    });

    if (!result.ok) {
        throw new Error(`Failed to fetch YouTube video transcript: ${result.statusText}`);
    }

    const text = await result.text();
    try {
        const data = JSON.parse(text);
        const transcript = data.transcript;
        const domParser = new DOMParser();
        const document = domParser.parseFromString(data.html, 'text/html');
        const title = document.querySelector('meta[itemprop="name"]')?.getAttribute('content');
        const description = document.querySelector('meta[itemprop="description"]')?.getAttribute('content');
        const date = document.querySelector('meta[itemprop="uploadDate"]')?.getAttribute('content');
        const author = document.querySelector('link[itemprop="name"]')?.getAttribute('content');
        const views = document.querySelector('meta[itemprop="interactionCount"]')?.getAttribute('content');

        return { title, date, views, author, description, transcript };
    } catch (error) {
        // If parsing metadata fails, return at least the transcript
        console.error("Error parsing YouTube metadata:", error);
        return { transcript: text };
    }
}

// Original visitLinks function (using hypothetical /api/visit-links)
async function visitLinks({ links }) {
    if (!links || !Array.isArray(links) || links.length === 0) {
        throw new Error('An array of links is required.');
    }

    const results = {};

    await Promise.all(links.map(async (url) => {
        if (!isValidUrl(url)) {
            results[url] = { error: 'Invalid URL provided.' };
            return;
        }

        try {
            const response = await fetch('/api/visit-links', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ url: url }),
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch content for ${url}: ${response.statusText}`);
            }

            const data = await response.json(); // Expecting { content: "..." }
            results[url] = { content: data.content || 'No content extracted.' };

        } catch (error) {
            console.error(`Error visiting link ${url}:`, error);
            results[url] = { error: error.message || 'Failed to fetch or process content.' };
        }
    }));

    return results;
}

// New visitLinksHtml function (using /api/search/visit)
async function visitLinksHtml({ links }) {
    if (!links || !Array.isArray(links) || links.length === 0) {
        throw new Error('An array of links is required.');
    }

    const results = {};

    await Promise.all(links.map(async (url) => {
        if (!isValidUrl(url)) {
            results[url] = { error: 'Invalid URL provided.' };
            return;
        }

        try {
            const response = await fetch('/api/search/visit', {
                method: 'POST',
                headers: getRequestHeaders(), // Ensure this includes X-CSRF-Token, Authorization, and Cookie
                body: JSON.stringify({ url: url, html: true }),
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch content for ${url}: ${response.statusText}`);
            }

            const data = await response.text(); // Assuming the response is plain HTML
            results[url] = { html: data || '' };

        } catch (error) {
            console.error(`Error visiting link ${url}:`, error);
            results[url] = { error: error.message || 'Failed to fetch or process content.' };
        }
    }));

    return results;
}


// --- Tool Registration ---

(function () {
    ToolManager.registerFunctionTool({
        name: 'GetUserEnvironment',
        displayName: 'User Environment',
        description: 'Returns the user environment information: preferred language, local date and time, and timezone.',
        parameters: getUserEnvironmentSchema,
        action: getUserEnvironment,
        formatMessage: () => 'Getting user environment...', // Provide some feedback
    });

    ToolManager.registerFunctionTool({
        name: 'GetYouTubeVideoScript',
        displayName: 'YouTube Video Script',
        description: 'Returns a YouTube video script. Called when a YouTube video URL is detected in the user input.',
        parameters: getYouTubeVideoScriptSchema,
        action: getYouTubeVideoScript,
        formatMessage: (args) => args && args.url ? `Getting video script for ${parseId(args.url)}...` : 'Getting video script...',
    });

    ToolManager.registerFunctionTool({
        name: 'VisitLinks',
        displayName: 'Visit Web Links',
        description: 'Visits the provided web links (URLs) and returns the content of the relevant pages (plain text).',
        parameters: visitLinksSchema,
        action: visitLinks,
        formatMessage: (args) => {
             const count = args?.links?.length || 0;
             if (count === 1) return `Visiting 1 link...`;
             if (count > 1) return `Visiting ${count} links...`;
             return 'Preparing to visit links...';
        },
    });

    // Register the new VisitLinksHtml tool
    ToolManager.registerFunctionTool({
        name: 'VisitLinksHtml',
        displayName: 'Visit Web Links (HTML)',
        description: 'Visits the provided web links (URLs) and returns the full HTML content of the relevant pages.',
        parameters: visitLinksHtmlSchema,
        action: visitLinksHtml,
        formatMessage: (args) => {
             const count = args?.links?.length || 0;
             if (count === 1) return `Visiting 1 link to get HTML...`;
             if (count > 1) return `Visiting ${count} links to get HTML...`;
             return 'Preparing to visit links to get HTML...';
        },
    });
})();
