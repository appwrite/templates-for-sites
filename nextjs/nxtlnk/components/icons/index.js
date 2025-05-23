import * as React from "react";

export const TwitterIcon = (props) => (
  <svg
    width={24}
    height={24}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M19.953 8.793c.012.176.012.353.012.53C19.965 14.746 15.837 21 8.29 21v-.004A11.615 11.615 0 0 1 2 19.155a8.239 8.239 0 0 0 6.073-1.7 4.108 4.108 0 0 1-3.834-2.85 4.09 4.09 0 0 0 1.853-.07A4.104 4.104 0 0 1 2.8 10.513v-.052c.57.318 1.21.494 1.863.514a4.108 4.108 0 0 1-1.27-5.48 11.646 11.646 0 0 0 8.456 4.288 4.108 4.108 0 0 1 6.992-3.742 8.234 8.234 0 0 0 2.607-.997 4.118 4.118 0 0 1-1.804 2.27A8.16 8.16 0 0 0 22 6.666a8.337 8.337 0 0 1-2.047 2.126Z"
      fill="#141414"
    />
  </svg>
);

export const DiscordIcon = (props) => (
  <svg
    width={24}
    height={24}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M18.93 6.514a16.491 16.491 0 0 0-4.07-1.262.062.062 0 0 0-.066.03c-.175.313-.37.721-.506 1.042a15.226 15.226 0 0 0-4.573 0A10.538 10.538 0 0 0 9.2 5.283a.064.064 0 0 0-.065-.031 16.447 16.447 0 0 0-4.07 1.262.058.058 0 0 0-.028.023c-2.593 3.874-3.303 7.653-2.954 11.384a.069.069 0 0 0 .026.047 16.586 16.586 0 0 0 4.994 2.524.065.065 0 0 0 .07-.023c.385-.525.728-1.079 1.022-1.662a.063.063 0 0 0-.035-.088 10.916 10.916 0 0 1-1.56-.743.064.064 0 0 1-.007-.107c.105-.078.21-.16.31-.242a.062.062 0 0 1 .065-.01c3.273 1.495 6.817 1.495 10.051 0a.062.062 0 0 1 .066.009c.1.082.205.165.31.243a.064.064 0 0 1-.005.107c-.499.291-1.017.537-1.561.743a.064.064 0 0 0-.034.088c.3.582.643 1.136 1.02 1.662a.064.064 0 0 0 .07.023 16.532 16.532 0 0 0 5.003-2.524.065.065 0 0 0 .026-.046c.417-4.314-.699-8.062-2.957-11.384a.05.05 0 0 0-.026-.024ZM8.684 15.65c-.985 0-1.797-.905-1.797-2.016 0-1.11.796-2.016 1.797-2.016 1.01 0 1.813.913 1.798 2.016 0 1.111-.796 2.016-1.798 2.016Zm6.646 0c-.986 0-1.797-.905-1.797-2.016 0-1.11.796-2.016 1.797-2.016 1.009 0 1.813.913 1.797 2.016 0 1.111-.788 2.016-1.797 2.016Z"
      fill="#fff"
    />
  </svg>
);

export const PlusIcon = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={props.width || 24}
    height={props.height || 24}
    fill={props.color || "#fff"}
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="feather feather-plus"
    {...props}
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const HomeIcon = (props) => (
  <span className="icon-home" {...props}></span>
);

export const ChevronRightIcon = (props) => (
  <span className="icon-cheveron-right" {...props}></span>
);

export const PassIcon = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={props.width || 24}
    height={props.height || 25}
    fill={'currentColor'}
    className="lfgicon-pass"
    {...props}
  >
    <path d="M9.21336 2.9807C9.52024 2.00137 10.2613 1.27827 11.1583 0.956909H2.43324C1.27386 0.956909 0.333984 1.89678 0.333984 3.05617V17.751C0.333984 18.9104 1.27385 19.8503 2.43324 19.8503H5.31697C4.72176 19.0657 4.50249 18.0145 4.81938 17.0032L9.21336 2.9807Z" fill="#D9D9D9" />
    <path d="M12.8456 1.91906C11.7393 1.57238 10.5614 2.18821 10.2147 3.29456L5.82073 17.3171C5.47405 18.4234 6.08989 19.6013 7.19623 19.948L17.2123 23.0865C18.3187 23.4332 19.4966 22.8174 19.8432 21.711L24.2372 7.68854C24.5839 6.58219 23.9681 5.40429 22.8617 5.05761L12.8456 1.91906Z" fill="#F16A30" />
  </svg>
);

export const HexIcon = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={0}
    height={0}
    fill={'#000'}
    stroke="#000"
    className="avatar-shape"
    {...props}
  >
    <clipPath id="hex" clipPathUnits="objectBoundingBox" transform="scale(0.005)">
      <path d="M193.248 73.9547C185.95 57.6268 177.44 41.9442 167.798 27.0561L164.688 22.3002C160.859 16.3899 155.841 11.4612 149.998 7.87254C144.155 4.28382 137.633 2.12515 130.908 1.5534L125.448 1.08526C108.508 -0.361754 91.4873 -0.361754 74.5479 1.08526L69.0879 1.5534C62.3625 2.12515 55.8413 4.28382 49.9981 7.87254C44.155 11.4612 39.1367 16.3899 35.3079 22.3002L32.1979 27.0986C22.5561 41.9868 14.0458 57.6693 6.74789 73.9972L4.39789 79.2531C1.50233 85.7356 0 92.8227 0 100C0 107.177 1.50233 114.264 4.39789 120.747L6.74789 126.003C14.0458 142.331 22.5561 158.014 32.1979 172.901L35.3079 177.7C39.1367 183.61 44.155 188.539 49.9981 192.128C55.8413 195.717 62.3625 197.875 69.0879 198.447L74.5479 198.915C91.4873 200.362 108.508 200.362 125.448 198.915L130.908 198.447C137.638 197.868 144.163 195.7 150.006 192.099C155.85 188.499 160.865 183.558 164.688 177.636L167.798 172.838C177.44 157.95 185.95 142.267 193.248 125.939L195.598 120.683C198.493 114.2 199.996 107.114 199.996 99.9362C199.996 92.7589 198.493 85.6718 195.598 79.1893L193.248 73.9547Z" />
    </clipPath>
  </svg >
);

export const OvalIcon = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={0}
    height={0}
    fill={'#000'}
    stroke="#000"
    className="avatar-shape"
    {...props}
  >
    <clipPath id="oval" clipPathUnits="objectBoundingBox" transform="scale(0.005)">
      <path d="M0 100C0 44.7715 44.7715 0 100 0C155.228 0 200 44.7715 200 100C200 155.228 155.228 200 100 200C44.7715 200 0 155.228 0 100Z" />
    </clipPath>
  </svg >
);

export const NewUp = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={props.width || 20}
    height={props.height || 20}
    fill={'currentColor'}
    className="new-up"
    {...props}
  >
    <path d="M5.83366 5C5.37343 5 5.00033 5.3731 5.00033 5.83333C5.00033 6.29357 5.37343 6.66667 5.83366 6.66667V5ZM14.167 5.83333H15.0003C15.0003 5.3731 14.6272 5 14.167 5V5.83333ZM13.3337 14.1667C13.3337 14.6269 13.7068 15 14.167 15C14.6272 15 15.0003 14.6269 15.0003 14.1667H13.3337ZM4.41108 14.4108C4.08563 14.7362 4.08563 15.2638 4.41108 15.5893C4.73651 15.9147 5.26415 15.9147 5.58958 15.5893L4.41108 14.4108ZM5.83366 6.66667H14.167V5H5.83366V6.66667ZM13.3337 5.83333V14.1667H15.0003V5.83333H13.3337ZM13.5777 5.24408L4.41108 14.4108L5.58958 15.5893L14.7562 6.42258L13.5777 5.24408Z" />

  </svg>
);

export const ThreeDIcon = (props) => (
  <svg
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M12 22L3 17V7L12 2L21 7V17L12 22Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 22V12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M21 7L12 12L3 7"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const DesignletterIcon = (props) => (
  <svg
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M22 6L12 13L2 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IllustrationsIcon = (props) => (
  <svg
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M13 2L3 14H12L11 22L21 10H12L13 2Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);




