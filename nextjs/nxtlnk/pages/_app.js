import { useState, useEffect } from "react";
import { useDarkMode } from "usehooks-ts";
import Head from "next/head";
import { ThemeProvider } from "styled-components";
import Layout from "../components/Layout";
import GlobalStyle from "../styles/GlobalStyle";
import { darkTheme, lightTheme } from "../styles/theme.config";
import { GoogleAnalytics } from "nextjs-google-analytics";
import { DefaultSeo } from 'next-seo';
import SEO from '../next-seo.config';

// Import only Pink icons
import "@appwrite.io/pink-icons";

function MyApp({ Component, pageProps }) {
    const [isMounted, setIsMounted] = useState(false);
    const { isDarkMode } = useDarkMode();

    const theme = isDarkMode ? {
        ...darkTheme,
        name: 'dark'
    } : {
        ...lightTheme,
        name: 'light'
    };

    useEffect(() => {
        setIsMounted(true);
        // Add dark theme class when dark mode is enabled
        if (isDarkMode) {
            document.documentElement.classList.add('theme-dark');
        } else {
            document.documentElement.classList.remove('theme-dark');
        }
    }, [isDarkMode]);

    if (!isMounted) return null;

    return (
        <>
            <GoogleAnalytics />
            <ThemeProvider theme={theme}>
                <Head>
                    <meta content="width=device-width, initial-scale=1" name="viewport" />
                    <link rel="icon" href="/favicon.ico" />
                </Head>
                <GlobalStyle />
                <Layout>
                    <DefaultSeo
                        canonical={SEO.openGraph.url}
                        {...SEO}
                        additionalMetaTags={[
                            {
                                name: 'keywords',
                                content: SEO.openGraph.keywords,
                            },
                            {
                                name: 'twitter:image',
                                content: SEO.openGraph.images[0].url
                            },
                            {
                                name: 'twitter:title',
                                content: SEO.openGraph.title,
                            },
                            {
                                name: 'twitter:description',
                                content: SEO.openGraph.description,
                            },
                            {
                                httpEquiv: 'x-ua-compatible',
                                content: 'IE=edge; chrome=1'
                            }
                        ]}
                    />
                    <Component {...pageProps} />
                </Layout>
            </ThemeProvider>
        </>
    );
}

export default MyApp;
