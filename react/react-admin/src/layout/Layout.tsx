import * as React from 'react';
import { Layout } from 'react-admin';
import AppBar from './AppBar';
import Menu from './Menu';

export default ({ children }: { children: React.ReactNode }) => (
    <Layout
        appBar={AppBar}
        menu={Menu}
        sx={{
            backgroundColor: theme =>
                // @ts-ignore Theme type mixing between different MUI versions
                (theme.vars || theme).palette.background.default,
        }}
    >
        {children}
    </Layout>
);