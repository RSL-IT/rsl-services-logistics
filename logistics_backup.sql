--
-- PostgreSQL database dump
--

\restrict B2XyNijY1vLyeNpRabnqsO0YcUg43kuiehnyGUDXxLbhFUM7PsIOX5skGPmvCav

-- Dumped from database version 17.7 (178558d)
-- Dumped by pg_dump version 17.7 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: neondb_owner
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO neondb_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: neondb_owner
--

COMMENT ON SCHEMA public IS '';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Session; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."Session" (
    id text NOT NULL,
    shop text NOT NULL,
    state text NOT NULL,
    "isOnline" boolean DEFAULT false NOT NULL,
    scope text,
    expires timestamp(3) without time zone,
    "accessToken" text NOT NULL,
    "userId" bigint,
    "firstName" text,
    "lastName" text,
    email text,
    "accountOwner" boolean DEFAULT false NOT NULL,
    locale text,
    collaborator boolean DEFAULT false,
    "emailVerified" boolean DEFAULT false
);


ALTER TABLE public."Session" OWNER TO neondb_owner;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO neondb_owner;

--
-- Name: tbl_logisticsUser; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."tbl_logisticsUser" (
    email text NOT NULL,
    "displayName" text,
    "userType" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "companyID" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    id integer NOT NULL,
    password text
);


ALTER TABLE public."tbl_logisticsUser" OWNER TO neondb_owner;

--
-- Name: tbl_logisticsUser_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."tbl_logisticsUser_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."tbl_logisticsUser_id_seq" OWNER TO neondb_owner;

--
-- Name: tbl_logisticsUser_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."tbl_logisticsUser_id_seq" OWNED BY public."tbl_logisticsUser".id;


--
-- Name: tbl_shipment; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.tbl_shipment (
    "containerNumber" text NOT NULL,
    "containerSize" text,
    "portOfOrigin" text,
    "destinationPort" text,
    "etaDate" timestamp(3) without time zone,
    status text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "companyId" text NOT NULL,
    "companyName" text NOT NULL,
    id integer NOT NULL
);


ALTER TABLE public.tbl_shipment OWNER TO neondb_owner;

--
-- Name: tbl_shipment_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.tbl_shipment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tbl_shipment_id_seq OWNER TO neondb_owner;

--
-- Name: tbl_shipment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.tbl_shipment_id_seq OWNED BY public.tbl_shipment.id;


--
-- Name: tbljn_company_rslModel; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."tbljn_company_rslModel" (
    "companyID" text NOT NULL,
    "rslModelID" text NOT NULL,
    id integer NOT NULL
);


ALTER TABLE public."tbljn_company_rslModel" OWNER TO neondb_owner;

--
-- Name: tbljn_company_rslModel_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."tbljn_company_rslModel_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."tbljn_company_rslModel_id_seq" OWNER TO neondb_owner;

--
-- Name: tbljn_company_rslModel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."tbljn_company_rslModel_id_seq" OWNED BY public."tbljn_company_rslModel".id;


--
-- Name: tbljn_logisticsUser_permission; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."tbljn_logisticsUser_permission" (
    id integer NOT NULL,
    "logisticsUserID" integer NOT NULL,
    "permissionID" integer NOT NULL
);


ALTER TABLE public."tbljn_logisticsUser_permission" OWNER TO neondb_owner;

--
-- Name: tbljn_logisticsUser_permission_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."tbljn_logisticsUser_permission_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."tbljn_logisticsUser_permission_id_seq" OWNER TO neondb_owner;

--
-- Name: tbljn_logisticsUser_permission_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."tbljn_logisticsUser_permission_id_seq" OWNED BY public."tbljn_logisticsUser_permission".id;


--
-- Name: tbljn_shipment_company_rslModel; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."tbljn_shipment_company_rslModel" (
    "shipmentID" text NOT NULL,
    "rslModelID" text NOT NULL,
    quantity integer NOT NULL,
    "companyID" text NOT NULL,
    id integer NOT NULL
);


ALTER TABLE public."tbljn_shipment_company_rslModel" OWNER TO neondb_owner;

--
-- Name: tbljn_shipment_company_rslModel_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."tbljn_shipment_company_rslModel_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."tbljn_shipment_company_rslModel_id_seq" OWNER TO neondb_owner;

--
-- Name: tbljn_shipment_company_rslModel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."tbljn_shipment_company_rslModel_id_seq" OWNED BY public."tbljn_shipment_company_rslModel".id;


--
-- Name: tlkp_bookingAgent; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."tlkp_bookingAgent" (
    "shortName" text NOT NULL,
    "displayName" text,
    id integer NOT NULL
);


ALTER TABLE public."tlkp_bookingAgent" OWNER TO neondb_owner;

--
-- Name: tlkp_bookingAgent_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."tlkp_bookingAgent_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."tlkp_bookingAgent_id_seq" OWNER TO neondb_owner;

--
-- Name: tlkp_bookingAgent_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."tlkp_bookingAgent_id_seq" OWNED BY public."tlkp_bookingAgent".id;


--
-- Name: tlkp_company; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.tlkp_company (
    "shortName" text NOT NULL,
    "displayName" text,
    address1 text,
    address2 text,
    city text,
    country text,
    "postalCode" text,
    "primaryContact" text,
    "primaryEmail" text,
    "primaryPhone" text,
    province text,
    "supplierCurrency" text,
    id integer NOT NULL
);


ALTER TABLE public.tlkp_company OWNER TO neondb_owner;

--
-- Name: tlkp_company_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.tlkp_company_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tlkp_company_id_seq OWNER TO neondb_owner;

--
-- Name: tlkp_company_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.tlkp_company_id_seq OWNED BY public.tlkp_company.id;


--
-- Name: tlkp_container; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.tlkp_container (
    "shortName" text NOT NULL,
    "displayName" text NOT NULL,
    id integer NOT NULL
);


ALTER TABLE public.tlkp_container OWNER TO neondb_owner;

--
-- Name: tlkp_container_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.tlkp_container_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tlkp_container_id_seq OWNER TO neondb_owner;

--
-- Name: tlkp_container_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.tlkp_container_id_seq OWNED BY public.tlkp_container.id;


--
-- Name: tlkp_deliveryAddress; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."tlkp_deliveryAddress" (
    "shortName" text NOT NULL,
    "displayName" text,
    id integer NOT NULL
);


ALTER TABLE public."tlkp_deliveryAddress" OWNER TO neondb_owner;

--
-- Name: tlkp_deliveryAddress_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."tlkp_deliveryAddress_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."tlkp_deliveryAddress_id_seq" OWNER TO neondb_owner;

--
-- Name: tlkp_deliveryAddress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."tlkp_deliveryAddress_id_seq" OWNED BY public."tlkp_deliveryAddress".id;


--
-- Name: tlkp_destinationPort; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."tlkp_destinationPort" (
    "shortName" text NOT NULL,
    "displayName" text,
    id integer NOT NULL
);


ALTER TABLE public."tlkp_destinationPort" OWNER TO neondb_owner;

--
-- Name: tlkp_destinationPort_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."tlkp_destinationPort_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."tlkp_destinationPort_id_seq" OWNER TO neondb_owner;

--
-- Name: tlkp_destinationPort_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."tlkp_destinationPort_id_seq" OWNED BY public."tlkp_destinationPort".id;


--
-- Name: tlkp_originPort; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."tlkp_originPort" (
    "shortName" text NOT NULL,
    "displayName" text,
    id integer NOT NULL
);


ALTER TABLE public."tlkp_originPort" OWNER TO neondb_owner;

--
-- Name: tlkp_originPort_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."tlkp_originPort_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."tlkp_originPort_id_seq" OWNER TO neondb_owner;

--
-- Name: tlkp_originPort_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."tlkp_originPort_id_seq" OWNED BY public."tlkp_originPort".id;


--
-- Name: tlkp_permission; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.tlkp_permission (
    id integer NOT NULL,
    "shortName" text NOT NULL,
    "displayName" text NOT NULL
);


ALTER TABLE public.tlkp_permission OWNER TO neondb_owner;

--
-- Name: tlkp_permission_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.tlkp_permission_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tlkp_permission_id_seq OWNER TO neondb_owner;

--
-- Name: tlkp_permission_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.tlkp_permission_id_seq OWNED BY public.tlkp_permission.id;


--
-- Name: tlkp_purchaseOrder; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."tlkp_purchaseOrder" (
    "shortName" text NOT NULL,
    "purchaseOrderGID" text NOT NULL,
    id integer NOT NULL
);


ALTER TABLE public."tlkp_purchaseOrder" OWNER TO neondb_owner;

--
-- Name: tlkp_purchaseOrder_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."tlkp_purchaseOrder_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."tlkp_purchaseOrder_id_seq" OWNER TO neondb_owner;

--
-- Name: tlkp_purchaseOrder_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."tlkp_purchaseOrder_id_seq" OWNED BY public."tlkp_purchaseOrder".id;


--
-- Name: tlkp_rslModel; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."tlkp_rslModel" (
    "shortName" text NOT NULL,
    "displayName" text NOT NULL,
    "SKU" text NOT NULL,
    id integer NOT NULL
);


ALTER TABLE public."tlkp_rslModel" OWNER TO neondb_owner;

--
-- Name: tlkp_rslModel_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public."tlkp_rslModel_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."tlkp_rslModel_id_seq" OWNER TO neondb_owner;

--
-- Name: tlkp_rslModel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public."tlkp_rslModel_id_seq" OWNED BY public."tlkp_rslModel".id;


--
-- Name: tbl_logisticsUser id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tbl_logisticsUser" ALTER COLUMN id SET DEFAULT nextval('public."tbl_logisticsUser_id_seq"'::regclass);


--
-- Name: tbl_shipment id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tbl_shipment ALTER COLUMN id SET DEFAULT nextval('public.tbl_shipment_id_seq'::regclass);


--
-- Name: tbljn_company_rslModel id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tbljn_company_rslModel" ALTER COLUMN id SET DEFAULT nextval('public."tbljn_company_rslModel_id_seq"'::regclass);


--
-- Name: tbljn_logisticsUser_permission id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tbljn_logisticsUser_permission" ALTER COLUMN id SET DEFAULT nextval('public."tbljn_logisticsUser_permission_id_seq"'::regclass);


--
-- Name: tbljn_shipment_company_rslModel id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tbljn_shipment_company_rslModel" ALTER COLUMN id SET DEFAULT nextval('public."tbljn_shipment_company_rslModel_id_seq"'::regclass);


--
-- Name: tlkp_bookingAgent id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_bookingAgent" ALTER COLUMN id SET DEFAULT nextval('public."tlkp_bookingAgent_id_seq"'::regclass);


--
-- Name: tlkp_company id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tlkp_company ALTER COLUMN id SET DEFAULT nextval('public.tlkp_company_id_seq'::regclass);


--
-- Name: tlkp_container id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tlkp_container ALTER COLUMN id SET DEFAULT nextval('public.tlkp_container_id_seq'::regclass);


--
-- Name: tlkp_deliveryAddress id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_deliveryAddress" ALTER COLUMN id SET DEFAULT nextval('public."tlkp_deliveryAddress_id_seq"'::regclass);


--
-- Name: tlkp_destinationPort id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_destinationPort" ALTER COLUMN id SET DEFAULT nextval('public."tlkp_destinationPort_id_seq"'::regclass);


--
-- Name: tlkp_originPort id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_originPort" ALTER COLUMN id SET DEFAULT nextval('public."tlkp_originPort_id_seq"'::regclass);


--
-- Name: tlkp_permission id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tlkp_permission ALTER COLUMN id SET DEFAULT nextval('public.tlkp_permission_id_seq'::regclass);


--
-- Name: tlkp_purchaseOrder id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_purchaseOrder" ALTER COLUMN id SET DEFAULT nextval('public."tlkp_purchaseOrder_id_seq"'::regclass);


--
-- Name: tlkp_rslModel id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_rslModel" ALTER COLUMN id SET DEFAULT nextval('public."tlkp_rslModel_id_seq"'::regclass);


--
-- Data for Name: Session; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."Session" (id, shop, state, "isOnline", scope, expires, "accessToken", "userId", "firstName", "lastName", email, "accountOwner", locale, collaborator, "emailVerified") FROM stdin;
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
1495f986-1db5-4516-9ea8-84501c4d1d8e	500639df59baa778224ac92a90ab79a19fe02cf7b7cb564fadda1c48017b47a3	2025-12-07 00:18:52.205051+00	20251031234549_powerbuy_codes_times_with_tz	\N	\N	2025-12-07 00:18:51.909035+00	1
be9e9446-ef58-4453-a001-d5b6ca964e90	a639bacca8f824e220f5513c89eea69108860b388ce88d1af99de009a01f8647	2025-12-07 00:18:43.887362+00	20250918000516_thirdpass	\N	\N	2025-12-07 00:18:43.535435+00	1
8387e790-b2a2-4107-9b21-7fad329196c4	52b19fc8eb39c37d6e88ba971483dea4fde14bec47a9e059977d5edc2e55113e	2025-12-07 00:18:49.35412+00	20251016204503_powerbuy_mods	\N	\N	2025-12-07 00:18:49.060671+00	1
3f0a8479-640a-4e3f-9512-56079e2c7c8b	4acef9e318efe83dba784689382e662ec1ba4828131662b9014cd40779ef86aa	2025-12-07 00:18:44.349677+00	20250925_baseline	\N	\N	2025-12-07 00:18:44.003413+00	1
73687003-e10d-4363-beff-9560b105a15c	34509a9006ab75729886aa101be8a77d46b0a502b87e84954112932438f43966	2025-12-07 00:18:44.813819+00	20250925_sync_neon_v3	\N	\N	2025-12-07 00:18:44.465428+00	1
7d654260-addd-4bad-a41e-e9c8df8b5b69	34f04ebc5b6e013d8e7e2be4340ca3ff87621b3d2927bdaa387f352039736a51	2025-12-07 00:18:45.219054+00	20250926_baseline_return_entry_fks	\N	\N	2025-12-07 00:18:44.930149+00	1
e4e7584b-b73f-4af2-b56e-6dcfe5b8b36b	8aed6daf785751e0f3f5d150068a0912142f3c3ff340b3afac59b251fa639b03	2025-12-07 00:18:49.765154+00	20251026015107_added_id_abstraction_to_the_powerbuy_and_allowed_stores	\N	\N	2025-12-07 00:18:49.47063+00	1
be41493a-9afc-4cac-9864-fb6d47027ffa	83294e18c2e64f22c2b2dc5ef9ffd4c0fed4070559a8438bc78ec0948c30abdc	2025-12-07 00:18:45.625426+00	20250926_baseline_return_entry_fks2	\N	\N	2025-12-07 00:18:45.333858+00	1
9e5f58b7-a6e6-4f70-bbe0-6fd545b54ad0	83d036f181c873b6e42bbba687a966d1701516d0ff579b762df448d85fb9ee7a	2025-12-07 00:18:46.035619+00	20250926142631_revised_return_entry_fields	\N	\N	2025-12-07 00:18:45.741747+00	1
4e4873b0-a382-47a1-9232-3177c8e9fdf3	47b895c407e6db7dd568275007c76421d0093efaeba0123b3a83c8165b8d443e	2025-12-07 00:23:34.502636+00	20251207002333_changed_supplier_to_company_continued	\N	\N	2025-12-07 00:23:34.216799+00	1
3611f559-dc0a-4b65-8bc4-cc3b95d8414d	b5f7be1cb90adb2919ae913844d912ae9ed5edcce2ffa08a24960191a25351b3	2025-12-07 00:18:46.444917+00	20250926200228_widen_return_entry_text_columns	\N	\N	2025-12-07 00:18:46.150174+00	1
6c48ce8f-3f8a-4a2e-9bed-31b275d2ea75	4133dde3408885f9b019c38d9ce95ed4f957d52552fdb8b35db028a0ec15dd33	2025-12-07 00:18:50.170303+00	20251026034118_added_length_of_the_discount_code	\N	\N	2025-12-07 00:18:49.88075+00	1
051a8382-c490-4365-bd69-88df820d0b95	88efda248765d3048da065e1526b43ebece010b365a5f41de1525fe7c924d921	2025-12-07 00:18:46.849864+00	20251007222829_add_tracking_and_closed_fields	\N	\N	2025-12-07 00:18:46.559899+00	1
b7fbe01e-493c-4132-8b16-da94035fa10a	4d1e7062b5c98221c2a545383dfa5b420cb7fab39158846a1f60b3a9c81adc79	2025-12-07 00:18:47.255422+00	20251007224656_add_shopify_return_gid	\N	\N	2025-12-07 00:18:46.965369+00	1
3b7938bf-d6bf-4026-b7a8-4e344c10e504	8ec79db9966524471e107a12e36421dfe2b60ab989df695d38aa742ac9fff6f1	2025-12-07 00:18:52.611899+00	20251101041855_revising_for_email_connection	\N	\N	2025-12-07 00:18:52.32003+00	1
0098c327-f591-4552-b031-518d3e399953	9fd4ff446f1edf24cc5883f288d3a4df64518c8cd86f615a04489b7814688d23	2025-12-07 00:18:47.675173+00	20251008234037_removed_department_and_repair_entry	\N	\N	2025-12-07 00:18:47.370904+00	1
6f5bd221-3a32-4558-bfeb-7ec4cab2ddde	65e9e64bee9a9cb9be1c708abd48c4d1e8ddbd9c8871e49143f8591fdf1b9832	2025-12-07 00:18:50.57628+00	20251026034434_added_discount_code_definition_enum_and_field_in_powerbuy_config	\N	\N	2025-12-07 00:18:50.285364+00	1
ee306e6c-36ed-453e-bfbc-50fcc58d62e0	91c67625a0711515ce6f48393f65b88fbf54224cf34786b2b4336fee473ddd7b	2025-12-07 00:18:48.116042+00	20251009162021_tweaked	\N	\N	2025-12-07 00:18:47.790633+00	1
62e72325-643e-418d-a2c5-f8d38ad5ffd5	7f80a18a41ca93d32cc9c529312ed5669fb842b8b9369f18dffed3e738c2d910	2025-12-07 00:18:48.528315+00	20251016171114_initial_powerbuy	\N	\N	2025-12-07 00:18:48.231562+00	1
f3c55897-6457-461a-a45f-bc3fdb124bc6	9a8d6e66e634ed0a853a9ee76a83dfdf32100631e2ada88135d66d42e1f987b9	2025-12-07 00:18:48.945238+00	20251016182750_tbl_powerbuy_requests_added_additional_tuning	\N	\N	2025-12-07 00:18:48.64355+00	1
22a975b5-0690-463e-a7fe-f71d739f0e6b	c13ef65245805ffe83d62e846ba17e0473a5db43b5347bfc5367a6dfc9628d08	2025-12-07 00:18:50.981223+00	20251026034645_changed_discount_code_definition_to_discount_code_type_for_brevity	\N	\N	2025-12-07 00:18:50.691285+00	1
1d22fb53-c481-496a-b01e-2eb4228bb1af	2bf9f0b7e00e34edfea0ab3c130268e59ebfddc1461f46c3f7ef8feafefc90cc	2025-12-07 00:18:54.685278+00	20251206235711_init_logistics	\N	\N	2025-12-07 00:18:54.352967+00	1
45c11bb0-51f7-47c6-8263-650085d0e808	ba98aa4c3b3cba8fefd7b585bd6b268021131a0789cd442bf9c7f4eceb1bf83d	2025-12-07 00:18:51.388102+00	20251026142417_added_duration_and_variant_ids	\N	\N	2025-12-07 00:18:51.097002+00	1
296052e7-efbf-4da8-901a-11fa438939f9	ee0f01118c0be9eae41658c98def5433a85a55004c683d324447931020abe2e0	2025-12-07 00:18:53.016887+00	20251101051630_email_override_for_debugging	\N	\N	2025-12-07 00:18:52.727702+00	1
02e721ea-1b4d-438d-acf8-49e99e6933fb	8c693720ca6e9e5e57be207976272a5c9de8486deee76a9653dc6eb21ffab905	2025-12-07 00:18:51.794286+00	20251031224635_powerbuy_cleanup	\N	\N	2025-12-07 00:18:51.502782+00	1
fa562e2e-1976-4b63-b073-8f6167433bf9	5be0e4ea8d01e741710b00547412d8ac0b43fccc91b78708cfca97a4315d57cc	2025-12-07 00:18:53.423381+00	20251101193550_add_code_id_to_requests	\N	\N	2025-12-07 00:18:53.132322+00	1
77cb5446-dd1c-488c-b579-c31972b5eaef	bfb021cc629fd29916a24cb7a836de7e7a317c252eb5c2bd2569e13b1382d4e1	2025-12-07 00:19:44.462647+00	20251207001943_changed_supplier_to_company	\N	\N	2025-12-07 00:19:44.176425+00	1
854f1e08-986b-4522-9207-87b4832d7bcc	e6b18d7d617d4af5ddede49d493f41d726c572cf087b929444e423cfce73485b	2025-12-07 00:18:53.834266+00	20251101224339_add_combineswith_discount	\N	\N	2025-12-07 00:18:53.541439+00	1
e1fbffde-d024-4731-86ee-87bd02e74c22	a98e9f25ab2eb344141072ff7f086afc6a9002c5717aeeecb1649682e285aa72	2025-12-07 00:18:54.238027+00	20251101224935_modified_discountcombineswith	\N	\N	2025-12-07 00:18:53.949665+00	1
8331cc74-a6b6-4896-a08b-c819f0b5c966	e518defb684449bdabd2b9fdf5ffdbf08c7f1cb0a24b477aef5d2a172c474bfa	2025-12-07 00:20:59.899421+00	20251207002059_changed_supplier_to_company	\N	\N	2025-12-07 00:20:59.600731+00	1
720f04a1-998c-4daa-af0f-6dec671407e2	39946d1135d49b76431caed2854acf3830101f543518f230f4824142b446eb17	2025-12-08 04:48:23.034913+00	20251208044822_added_permission_lookup_and_join_tables	\N	\N	2025-12-08 04:48:22.699305+00	1
3d4333bb-0667-49cd-aded-3d114f03ee6c	6929a2b23feddc61ac84b323d976c57c525d13d917e43400bf78d22cb687cdbe	2025-12-07 02:09:10.344188+00	20251207020909_updated	\N	\N	2025-12-07 02:09:10.038892+00	1
66bfee22-13ef-4ba5-899f-2724a9d3291d	b77196cf1b52875dd25fdb9b7971fb8bdb7bab9750f489dc88fde9184fe4f0ec	2025-12-07 07:00:05.205328+00	20251207070004_changed	\N	\N	2025-12-07 07:00:04.910649+00	1
7d303eab-a5bd-4c9d-841b-5a5265e9ffc8	5ed3bcdb595f5464b4c52b64c4fd945af9b78a1e360c4693beec38e49af1244b	2025-12-07 02:27:26.824458+00	20251207022726_changed	\N	\N	2025-12-07 02:27:26.388995+00	1
6422713d-3096-40a5-9498-b298139c78fd	16a19038165831bda83cf07da75505cc567300777e27bc84bba38e3e49391358	2025-12-08 05:14:54.203544+00	20251208051453_added_password_to_the_logistics_user	\N	\N	2025-12-08 05:14:53.919296+00	1
\.


--
-- Data for Name: tbl_logisticsUser; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."tbl_logisticsUser" (email, "displayName", "userType", "isActive", "companyID", "createdAt", "updatedAt", id, password) FROM stdin;
itadmin@rslspeakers.com	RSL IT Administrator	internal	t	1	2025-12-08 05:04:12.84	2025-12-07 23:04:02	2	$2a$12$NHHSwyBFmXI.wNuX8ZW/r.ME22OU4XORhmbd/TzaU3xQb3.2QRss2
\.


--
-- Data for Name: tbl_shipment; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.tbl_shipment ("containerNumber", "containerSize", "portOfOrigin", "destinationPort", "etaDate", status, "createdAt", "updatedAt", "companyId", "companyName", id) FROM stdin;
\.


--
-- Data for Name: tbljn_company_rslModel; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."tbljn_company_rslModel" ("companyID", "rslModelID", id) FROM stdin;
\.


--
-- Data for Name: tbljn_logisticsUser_permission; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."tbljn_logisticsUser_permission" (id, "logisticsUserID", "permissionID") FROM stdin;
1	1	1
2	1	2
3	1	3
4	1	4
5	1	5
6	1	6
7	1	7
8	1	8
9	1	9
\.


--
-- Data for Name: tbljn_shipment_company_rslModel; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."tbljn_shipment_company_rslModel" ("shipmentID", "rslModelID", quantity, "companyID", id) FROM stdin;
\.


--
-- Data for Name: tlkp_bookingAgent; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."tlkp_bookingAgent" ("shortName", "displayName", id) FROM stdin;
HLS	Honor Lane Shipping	1
365	FREIGHT AND CUSTOMS PTY LTD	2
DHL	\N	3
FedEx	\N	4
UPS	\N	5
SF	\N	6
Other	\N	7
\.


--
-- Data for Name: tlkp_company; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.tlkp_company ("shortName", "displayName", address1, address2, city, country, "postalCode", "primaryContact", "primaryEmail", "primaryPhone", province, "supplierCurrency", id) FROM stdin;
RSL	Rogersound Labs, LLC	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	1
HS	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2
YY	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	3
JY	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	4
AD	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	5
LD	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	6
OA	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	7
SM	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	8
Other	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	9
\.


--
-- Data for Name: tlkp_container; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.tlkp_container ("shortName", "displayName", id) FROM stdin;
20 ft.	20 ft. (Std. ~1170 cu. ft.)	1
20 ft. HC	20 ft. (High Cube)	2
40 ft.	40 ft. (Standard ~2390)	3
40 ft. HC	40 ft. High Cube (HC ~2690)	4
45 ft. HC	45 ft. High Cube (HC ~3040 cu. ft.)	5
\.


--
-- Data for Name: tlkp_deliveryAddress; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."tlkp_deliveryAddress" ("shortName", "displayName", id) FROM stdin;
\.


--
-- Data for Name: tlkp_destinationPort; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."tlkp_destinationPort" ("shortName", "displayName", id) FROM stdin;
USLAX	\N	2
USLGB	\N	3
AUMEL	\N	4
Other	\N	5
\.


--
-- Data for Name: tlkp_originPort; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."tlkp_originPort" ("shortName", "displayName", id) FROM stdin;
\.


--
-- Data for Name: tlkp_permission; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.tlkp_permission (id, "shortName", "displayName") FROM stdin;
1	user_view	View User Management
2	user_update	Update User Info
3	user_create	Create Users
4	user_delete	Delete Users
5	shipment_create	Create a Shipment
6	shipment_update	Update Shipment Info
7	shipment_view	View Shipment Info
8	dashboard_view	View RSL Dashboard
9	dashboard_update	Modify the Dashboard
\.


--
-- Data for Name: tlkp_purchaseOrder; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."tlkp_purchaseOrder" ("shortName", "purchaseOrderGID", id) FROM stdin;
\.


--
-- Data for Name: tlkp_rslModel; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."tlkp_rslModel" ("shortName", "displayName", "SKU", id) FROM stdin;
\.


--
-- Name: tbl_logisticsUser_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."tbl_logisticsUser_id_seq"', 2, true);


--
-- Name: tbl_shipment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.tbl_shipment_id_seq', 1, false);


--
-- Name: tbljn_company_rslModel_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."tbljn_company_rslModel_id_seq"', 1, false);


--
-- Name: tbljn_logisticsUser_permission_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."tbljn_logisticsUser_permission_id_seq"', 9, true);


--
-- Name: tbljn_shipment_company_rslModel_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."tbljn_shipment_company_rslModel_id_seq"', 1, false);


--
-- Name: tlkp_bookingAgent_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."tlkp_bookingAgent_id_seq"', 7, true);


--
-- Name: tlkp_company_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.tlkp_company_id_seq', 9, true);


--
-- Name: tlkp_container_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.tlkp_container_id_seq', 5, true);


--
-- Name: tlkp_deliveryAddress_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."tlkp_deliveryAddress_id_seq"', 1, false);


--
-- Name: tlkp_destinationPort_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."tlkp_destinationPort_id_seq"', 5, true);


--
-- Name: tlkp_originPort_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."tlkp_originPort_id_seq"', 1, false);


--
-- Name: tlkp_permission_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.tlkp_permission_id_seq', 9, true);


--
-- Name: tlkp_purchaseOrder_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."tlkp_purchaseOrder_id_seq"', 1, false);


--
-- Name: tlkp_rslModel_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public."tlkp_rslModel_id_seq"', 1, false);


--
-- Name: Session Session_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: tbl_logisticsUser tbl_logisticsUser_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tbl_logisticsUser"
    ADD CONSTRAINT "tbl_logisticsUser_pkey" PRIMARY KEY (id);


--
-- Name: tbl_shipment tbl_shipment_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tbl_shipment
    ADD CONSTRAINT tbl_shipment_pkey PRIMARY KEY (id);


--
-- Name: tbljn_company_rslModel tbljn_company_rslModel_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tbljn_company_rslModel"
    ADD CONSTRAINT "tbljn_company_rslModel_pkey" PRIMARY KEY (id);


--
-- Name: tbljn_logisticsUser_permission tbljn_logisticsUser_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tbljn_logisticsUser_permission"
    ADD CONSTRAINT "tbljn_logisticsUser_permission_pkey" PRIMARY KEY (id);


--
-- Name: tbljn_shipment_company_rslModel tbljn_shipment_company_rslModel_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tbljn_shipment_company_rslModel"
    ADD CONSTRAINT "tbljn_shipment_company_rslModel_pkey" PRIMARY KEY (id);


--
-- Name: tlkp_bookingAgent tlkp_bookingAgent_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_bookingAgent"
    ADD CONSTRAINT "tlkp_bookingAgent_pkey" PRIMARY KEY (id);


--
-- Name: tlkp_company tlkp_company_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tlkp_company
    ADD CONSTRAINT tlkp_company_pkey PRIMARY KEY (id);


--
-- Name: tlkp_container tlkp_container_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tlkp_container
    ADD CONSTRAINT tlkp_container_pkey PRIMARY KEY (id);


--
-- Name: tlkp_deliveryAddress tlkp_deliveryAddress_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_deliveryAddress"
    ADD CONSTRAINT "tlkp_deliveryAddress_pkey" PRIMARY KEY (id);


--
-- Name: tlkp_destinationPort tlkp_destinationPort_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_destinationPort"
    ADD CONSTRAINT "tlkp_destinationPort_pkey" PRIMARY KEY (id);


--
-- Name: tlkp_originPort tlkp_originPort_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_originPort"
    ADD CONSTRAINT "tlkp_originPort_pkey" PRIMARY KEY (id);


--
-- Name: tlkp_permission tlkp_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tlkp_permission
    ADD CONSTRAINT tlkp_permission_pkey PRIMARY KEY (id);


--
-- Name: tlkp_purchaseOrder tlkp_purchaseOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_purchaseOrder"
    ADD CONSTRAINT "tlkp_purchaseOrder_pkey" PRIMARY KEY (id);


--
-- Name: tlkp_rslModel tlkp_rslModel_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."tlkp_rslModel"
    ADD CONSTRAINT "tlkp_rslModel_pkey" PRIMARY KEY (id);


--
-- Name: Session_expires_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX "Session_expires_idx" ON public."Session" USING btree (expires);


--
-- Name: Session_shop_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX "Session_shop_idx" ON public."Session" USING btree (shop);


--
-- Name: tbl_logisticsUser_email_key; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX "tbl_logisticsUser_email_key" ON public."tbl_logisticsUser" USING btree (email);


--
-- Name: tbl_shipment_containerNumber_key; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX "tbl_shipment_containerNumber_key" ON public.tbl_shipment USING btree ("containerNumber");


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: neondb_owner
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION;


--
-- PostgreSQL database dump complete
--

\unrestrict B2XyNijY1vLyeNpRabnqsO0YcUg43kuiehnyGUDXxLbhFUM7PsIOX5skGPmvCav

