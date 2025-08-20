import * as React from 'react';
import { Typography } from '@mui/material';
import {
    Login as RaLogin,
    LoginForm,
    useTranslate,
    TextInput,
    required,
    PasswordInput,
} from 'react-admin';

const Login = () => {
    const translate = useTranslate();
    return (
        <RaLogin sx={{ background: 'none' }}>
            <Typography color="text.disabled" textAlign="center">
                Hint: john.doe@marmelab.com / changeme
            </Typography>
            <LoginForm>
                <TextInput
                    autoFocus
                    source="email"
                    label={translate('ra.auth.email', { _: 'Email' })}
                    autoComplete="email"
                    type="email"
                    validate={required()}
                />
                <PasswordInput
                    source="password"
                    label={translate('ra.auth.password', { _: 'Password' })}
                    autoComplete="current-password"
                    validate={required()}
                />
            </LoginForm>
        </RaLogin>
    );
};

export default Login;
