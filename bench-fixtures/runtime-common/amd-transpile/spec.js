import { buildTask as _buildTask } from "ember-concurrency/-private/async-arrow-runtime";
import { contains, field, Component, CardDef, relativeTo, linksToMany, FieldDef, containsMany, getCardMeta } from './card-api';
import StringField from './string';
import BooleanField from './boolean';
import CodeRef from './code-ref';
import MarkdownField from './markdown';
import { FieldContainer, Pill, RealmIcon, BoxelInput, BoxelButton, BasicFitted } from '@cardstack/boxel-ui/components';
import { getMenuItems, cardIdToURL, codeRefWithAbsoluteURL, ensureExtension, isPrimitive, isResolvedCodeRef, isSpec, loadCardDef, realmURL, resolveCardReference } from '@cardstack/runtime-common';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { AiBw as AiBwIcon } from '@cardstack/boxel-ui/icons';
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { task } from 'ember-concurrency';
import BoxModel from '@cardstack/boxel-icons/box-model';
import BookOpenText from '@cardstack/boxel-icons/book-open-text';
import LayersSubtract from '@cardstack/boxel-icons/layers-subtract';
import GitBranch from '@cardstack/boxel-icons/git-branch';
import { DiagonalArrowLeftUp as ExportArrow } from '@cardstack/boxel-ui/icons';
import StackIcon from '@cardstack/boxel-icons/stack';
import AppsIcon from '@cardstack/boxel-icons/apps';
import LayoutList from '@cardstack/boxel-icons/layout-list';
import { use, resource } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';
import GenerateReadmeSpecCommand from '@cardstack/boxel-host/commands/generate-readme-spec';
import PopulateWithSampleDataCommand from '@cardstack/boxel-host/commands/populate-with-sample-data';
import GenerateExampleCardsCommand from '@cardstack/boxel-host/commands/generate-example-cards';
import { provide } from 'ember-provide-consume-context';
import { PermissionsContextName } from '@cardstack/runtime-common';
import "./spec.gts.CiAgLmJveFtkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLTUyOTg0YWZmOTRdIHsKICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJveGVsLWJvcmRlci1jb2xvcik7CiAgICBib3JkZXItcmFkaXVzOiB2YXIoLS1ib3hlbC1ib3JkZXItcmFkaXVzLWxnKTsKICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJveGVsLWxpZ2h0KTsKICB9CiAgLmhlYWRlcltkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLTUyOTg0YWZmOTRdIHsKICAgIGRpc3BsYXk6IGZsZXg7CiAgICBnYXA6IHZhcigtLWJveGVsLXNwLXNtKTsKICB9CiAgLmhlYWRlci1pY29uLWNvbnRhaW5lcltkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLTUyOTg0YWZmOTRdIHsKICAgIGZsZXgtc2hyaW5rOiAwOwogICAgaGVpZ2h0OiB2YXIoLS1ib3hlbC1pY29uLXh4bCk7CiAgICB3aWR0aDogdmFyKC0tYm94ZWwtaWNvbi14eGwpOwogICAgZGlzcGxheTogZmxleDsKICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsKICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJveGVsLTEwMCk7CiAgfQogIC5oZWFkZXItaW5mby1jb250YWluZXJbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS01Mjk4NGFmZjk0XSB7CiAgICBmbGV4OiAxOwogICAgYWxpZ24tc2VsZjogY2VudGVyOwogIH0KICAvKiBFZGl0IG1vZGUgc3BlY2lmaWMgc3R5bGVzICovCiAgLmhlYWRlci1pbmZvLWNvbnRhaW5lcltkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLTUyOTg0YWZmOTRdOmhhcyguaGVhZGVyLXRpdGxlLWNvbnRhaW5lcikgewogICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tYm94ZWwtbGlnaHQpOwogICAgYm9yZGVyLXJhZGl1czogdmFyKC0tYm94ZWwtYm9yZGVyLXJhZGl1cyk7CiAgfQogIC5oZWFkZXItaW5mby1jb250YWluZXIgPiBkaXYgKyBkaXZbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS01Mjk4NGFmZjk0XSB7CiAgICBib3JkZXItdG9wOiAxcHggc29saWQgdmFyKC0tYm94ZWwtc3BlYy1iYWNrZ3JvdW5kLWNvbG9yKTsKICB9CiAgLmhlYWRlci10aXRsZS1jb250YWluZXJbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS01Mjk4NGFmZjk0XSwKICAuaGVhZGVyLWRlc2NyaXB0aW9uLWNvbnRhaW5lcltkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLTUyOTg0YWZmOTRdIHsKICAgIHBhZGRpbmc6IHZhcigtLWJveGVsLXNwLXhzKTsKICB9CiAgLyogSXNvbGF0ZWQgbW9kZSBzcGVjaWZpYyBzdHlsZXMgKi8KICBoMS50aXRsZVtkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLTUyOTg0YWZmOTRdIHsKICAgIG1hcmdpbjogMDsKICAgIGZvbnQtc2l6ZTogMThweDsKICAgIGZvbnQtd2VpZ2h0OiA2MDA7CiAgICBsZXR0ZXItc3BhY2luZzogdmFyKC0tYm94ZWwtbHNwLXhzKTsKICAgIGxpbmUtaGVpZ2h0OiAxLjI7CiAgfQogIHAuZGVzY3JpcHRpb25bZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS01Mjk4NGFmZjk0XSB7CiAgICBtYXJnaW4tdG9wOiB2YXIoLS1ib3hlbC1zcC00eHMpOwogICAgbWFyZ2luLWJvdHRvbTogMDsKICB9CiAgLnRpdGxlW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtNTI5ODRhZmY5NF0sCiAgLmRlc2NyaXB0aW9uW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtNTI5ODRhZmY5NF0gewogICAgZGlzcGxheTogLXdlYmtpdC1ib3g7CiAgICAtd2Via2l0LWJveC1vcmllbnQ6IHZlcnRpY2FsOwogICAgLXdlYmtpdC1saW5lLWNsYW1wOiAyOwogICAgb3ZlcmZsb3c6IGhpZGRlbjsKICAgIHRleHQtd3JhcDogcHJldHR5OwogIH0K.glimmer-scoped.css";
import { setComponentTemplate } from "@ember/component";
import { createTemplateFactory } from "@ember/template-factory";
import "./spec.gts.CiAgLnNlY3Rpb25bZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS1jNzRkMzI0YzI0XSB7CiAgICBtYXJnaW4tdG9wOiB2YXIoLS1ib3hlbC1zcCk7CiAgICBwYWRkaW5nLXRvcDogdmFyKC0tYm94ZWwtc3ApOwogICAgYm9yZGVyLXRvcDogMXB4IHNvbGlkIHZhcigtLWJveGVsLTQwMCk7CiAgfQogIGgyW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYzc0ZDMyNGMyNF0gewogICAgbWFyZ2luOiAwOwogICAgZm9udDogNjAwIHZhcigtLWJveGVsLWZvbnQtc20pOwogICAgbGV0dGVyLXNwYWNpbmc6IHZhcigtLWJveGVsLWxzcC14cyk7CiAgfQogIC5yb3ctaGVhZGVyW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYzc0ZDMyNGMyNF0gewogICAgZGlzcGxheTogZmxleDsKICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW47CiAgICBnYXA6IHZhcigtLWJveGVsLXNwLXhzKTsKICAgIHBhZGRpbmctYm90dG9tOiB2YXIoLS1ib3hlbC1zcC1sZyk7CiAgfQogIC5yb3ctaGVhZGVyLWxlZnRbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS1jNzRkMzI0YzI0XSB7CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGdhcDogdmFyKC0tYm94ZWwtc3AteHMpOwogIH0K.glimmer-scoped.css";
import "./spec.gts.CiAgLnNlY3Rpb25bZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS1iM2FlNzlhMTdhXSB7CiAgICBtYXJnaW4tdG9wOiB2YXIoLS1ib3hlbC1zcCk7CiAgICBwYWRkaW5nLXRvcDogdmFyKC0tYm94ZWwtc3ApOwogICAgYm9yZGVyLXRvcDogMXB4IHNvbGlkIHZhcigtLWJveGVsLTQwMCk7CiAgfQogIGgyW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYjNhZTc5YTE3YV0gewogICAgbWFyZ2luOiAwOwogICAgZm9udDogNjAwIHZhcigtLWJveGVsLWZvbnQtc20pOwogICAgbGV0dGVyLXNwYWNpbmc6IHZhcigtLWJveGVsLWxzcC14cyk7CiAgfQogIC5yb3ctaGVhZGVyW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYjNhZTc5YTE3YV0gewogICAgZGlzcGxheTogZmxleDsKICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICBnYXA6IHZhcigtLWJveGVsLXNwLXhzKTsKICAgIHBhZGRpbmctYm90dG9tOiB2YXIoLS1ib3hlbC1zcC1sZyk7CiAgfQogIC5yb3ctaGVhZGVyLWxlZnRbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS1iM2FlNzlhMTdhXSB7CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGdhcDogdmFyKC0tYm94ZWwtc3AteHMpOwogIH0KICAuc3BlYy1leGFtcGxlLWluY29tcGF0aWJsZS1tZXNzYWdlW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYjNhZTc5YTE3YV0gewogICAgZm9udDogdmFyKC0tYm94ZWwtZm9udC1zbSk7CiAgICBjb2xvcjogdmFyKC0tYm94ZWwtNDUwKTsKICAgIGZvbnQtd2VpZ2h0OiA1MDA7CiAgICBtYXJnaW4tYmxvY2s6IDA7CiAgfQo%3D.glimmer-scoped.css";
import "./spec.gts.CiAgLnNlY3Rpb25bZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS1hNjQwMTdjMTY0XSB7CiAgICBtYXJnaW4tdG9wOiB2YXIoLS1ib3hlbC1zcCk7CiAgICBwYWRkaW5nLXRvcDogdmFyKC0tYm94ZWwtc3ApOwogICAgYm9yZGVyLXRvcDogMXB4IHNvbGlkIHZhcigtLWJveGVsLTQwMCk7CiAgfQogIGgyW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYTY0MDE3YzE2NF0gewogICAgbWFyZ2luOiAwOwogICAgZm9udDogNjAwIHZhcigtLWJveGVsLWZvbnQtc20pOwogICAgbGV0dGVyLXNwYWNpbmc6IHZhcigtLWJveGVsLWxzcC14cyk7CiAgfQogIC5yb3ctaGVhZGVyW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYTY0MDE3YzE2NF0gewogICAgZGlzcGxheTogZmxleDsKICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW47CiAgICBnYXA6IHZhcigtLWJveGVsLXNwLXhzKTsKICAgIHBhZGRpbmctYm90dG9tOiB2YXIoLS1ib3hlbC1zcC1sZyk7CiAgfQogIC5yb3ctaGVhZGVyLWxlZnRbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS1hNjQwMTdjMTY0XSB7CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGdhcDogdmFyKC0tYm94ZWwtc3AteHMpOwogIH0KICAuZXhhbXBsZXMtd2l0aC1pbnRlcmFjdGl2ZS1wcmV2aWV3W2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYTY0MDE3YzE2NF0gewogICAgZGlzcGxheTogZmxleDsKICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47CiAgICBnYXA6IHZhcigtLWJveGVsLXNwKTsKICB9CiAgLmV4YW1wbGVzLXdpdGgtaW50ZXJhY3RpdmUtZ3JpZFtkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLWE2NDAxN2MxNjRdIHsKICAgIGRpc3BsYXk6IGdyaWQ7CiAgICBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IHJlcGVhdChhdXRvLWZpdCwgbWlubWF4KDMyMHB4LCAxZnIpKTsKICAgIGdhcDogdmFyKC0tYm94ZWwtc3ApOwogIH0KICAuZXhhbXBsZXMtd2l0aC1pbnRlcmFjdGl2ZS1jYXJkW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYTY0MDE3YzE2NF0gewogICAgYm9yZGVyOiB2YXIoLS1ib3hlbC1ib3JkZXIpOwogICAgYm9yZGVyLXJhZGl1czogdmFyKC0tYm94ZWwtYm9yZGVyLXJhZGl1cyk7CiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ib3hlbC0xMDApOwogICAgcGFkZGluZzogdmFyKC0tYm94ZWwtc3AteHMpOwogICAgZGlzcGxheTogZmxleDsKICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47CiAgICBnYXA6IHZhcigtLWJveGVsLXNwLXhzKTsKICB9Cg%3D%3D.glimmer-scoped.css";
import "./spec.gts.CiAgLnNlY3Rpb25bZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS1hMDliMzJkNjc1XSB7CiAgICBtYXJnaW4tdG9wOiB2YXIoLS1ib3hlbC1zcCk7CiAgICBwYWRkaW5nLXRvcDogdmFyKC0tYm94ZWwtc3ApOwogICAgYm9yZGVyLXRvcDogMXB4IHNvbGlkIHZhcigtLWJveGVsLTQwMCk7CiAgfQogIGgyW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYTA5YjMyZDY3NV0gewogICAgbWFyZ2luOiAwOwogICAgZm9udDogNjAwIHZhcigtLWJveGVsLWZvbnQtc20pOwogICAgbGV0dGVyLXNwYWNpbmc6IHZhcigtLWJveGVsLWxzcC14cyk7CiAgfQogIC5yb3ctaGVhZGVyW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYTA5YjMyZDY3NV0gewogICAgZGlzcGxheTogZmxleDsKICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICBnYXA6IHZhcigtLWJveGVsLXNwLXhzKTsKICAgIHBhZGRpbmctYm90dG9tOiB2YXIoLS1ib3hlbC1zcC1sZyk7CiAgfQogIC5yb3ctaGVhZGVyLWxlZnRbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS1hMDliMzJkNjc1XSB7CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGdhcDogdmFyKC0tYm94ZWwtc3AteHMpOwogIH0KICAuY29kZS1yZWYtY29udGFpbmVyW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtYTA5YjMyZDY3NV0gewogICAgZGlzcGxheTogZmxleDsKICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47CiAgICBnYXA6IHZhcigtLWJveGVsLXNwLXhzKTsKICB9CiAgLmNvZGUtcmVmLXJvd1tkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLWEwOWIzMmQ2NzVdIHsKICAgIGRpc3BsYXk6IGZsZXg7CiAgICBhbGlnbi1pdGVtczogY2VudGVyOwogICAgZ2FwOiB2YXIoLS1ib3hlbC1zcC14cyk7CiAgICBtaW4taGVpZ2h0OiB2YXIoLS1ib3hlbC1mb3JtLWNvbnRyb2wtaGVpZ2h0KTsKICAgIHBhZGRpbmc6IHZhcigtLWJveGVsLXNwLXhzKTsKICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigKICAgICAgLS1ib3hlbC1zcGVjLWNvZGUtcmVmLWJhY2tncm91bmQtY29sb3IsCiAgICAgIHZhcigtLWJveGVsLTEwMCkKICAgICk7CiAgICBib3JkZXI6IHZhcigtLWJveGVsLWJvcmRlcik7CiAgICBib3JkZXItcmFkaXVzOiB2YXIoLS1ib3hlbC1ib3JkZXItcmFkaXVzKTsKICAgIGNvbG9yOiB2YXIoLS1ib3hlbC1zcGVjLWNvZGUtcmVmLXRleHQtY29sb3IsIHZhcigtLWJveGVsLTQ1MCkpOwogIH0KICAuY29kZS1yZWYtdmFsdWVbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS1hMDliMzJkNjc1XSB7CiAgICB3aGl0ZS1zcGFjZTogbm93cmFwOwogICAgb3ZlcmZsb3c6IGhpZGRlbjsKICAgIHRleHQtb3ZlcmZsb3c6IGVsbGlwc2lzOwogIH0KICAuZXhwb3J0ZWQtdHlwZVtkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLWEwOWIzMmQ2NzVdIHsKICAgIG1hcmdpbi1sZWZ0OiBhdXRvOwogICAgY29sb3I6IHZhcigtLWJveGVsLTQ1MCk7CiAgICBmb250OiA1MDAgdmFyKC0tYm94ZWwtZm9udC14cyk7CiAgICBsZXR0ZXItc3BhY2luZzogdmFyKC0tYm94ZWwtbHNwKTsKICAgIHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7CiAgfQogIC5leHBvcnRlZC1hcnJvd1tkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLWEwOWIzMmQ2NzVdIHsKICAgIG1pbi13aWR0aDogOHB4OwogICAgbWluLWhlaWdodDogOHB4OwogIH0KICAucmVhbG0taWNvbltkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLWEwOWIzMmQ2NzVdIHsKICAgIHdpZHRoOiAxOHB4OwogICAgaGVpZ2h0OiAxOHB4OwogICAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm94ZWwtZGFyayk7CiAgfQo%3D.glimmer-scoped.css";
import "./spec.gts.CiAgLmNvbnRhaW5lcltkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLTFiODJiYTY2ODFdIHsKICAgIC0tYm94ZWwtc3BlYy1iYWNrZ3JvdW5kLWNvbG9yOiAjZWJlYWVkOwogICAgLS1ib3hlbC1zcGVjLWNvZGUtcmVmLWJhY2tncm91bmQtY29sb3I6ICNlMmUyZTI7CiAgICAtLWJveGVsLXNwZWMtY29kZS1yZWYtdGV4dC1jb2xvcjogIzY0NjQ2NDsKCiAgICBoZWlnaHQ6IDEwMCU7CiAgICBtaW4taGVpZ2h0OiBtYXgtY29udGVudDsKICAgIHBhZGRpbmc6IHZhcigtLWJveGVsLXNwKTsKICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJveGVsLXNwZWMtYmFja2dyb3VuZC1jb2xvcik7CiAgfQo%3D.glimmer-scoped.css";
import "./spec.gts.CiAgQGxheWVyIHsKICAgIC5zcGVjLWZpdHRlZFtkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLWM2YWViZDc4YmJdIHsKICAgICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIH0KICB9Cg%3D%3D.glimmer-scoped.css";
import "./spec.gts.CiAgLmNvbnRhaW5lcltkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLThkM2U2MjMzMDBdIHsKICAgIC0tYm94ZWwtc3BlYy1iYWNrZ3JvdW5kLWNvbG9yOiAjZWJlYWVkOwogICAgLS1ib3hlbC1zcGVjLWNvZGUtcmVmLWJhY2tncm91bmQtY29sb3I6ICNlMmUyZTI7CiAgICAtLWJveGVsLXNwZWMtY29kZS1yZWYtdGV4dC1jb2xvcjogIzY0NjQ2NDsKCiAgICBoZWlnaHQ6IDEwMCU7CiAgICBtaW4taGVpZ2h0OiBtYXgtY29udGVudDsKICAgIHBhZGRpbmc6IHZhcigtLWJveGVsLXNwKTsKICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJveGVsLXNwZWMtYmFja2dyb3VuZC1jb2xvcik7CiAgfQogIFtkYXRhLXNjb3BlZGNzcy0xZjJlMGRiYTRhLThkM2U2MjMzMDBdIC5hZGQtbmV3IHsKICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlciwgdmFyKC0tYm94ZWwtYm9yZGVyLWNvbG9yKSk7CiAgfQo%3D.glimmer-scoped.css";
import "./spec.gts.CiAgLnNwZWMtdGl0bGUtaW5wdXRbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS0xZGM4MTQ5Yzc5XSB7CiAgICBmb250LXNpemU6IDE4cHg7CiAgICBmb250LXdlaWdodDogNjAwOwogICAgbGV0dGVyLXNwYWNpbmc6IHZhcigtLWJveGVsLWxzcC14cyk7CiAgICBwYWRkaW5nOiB2YXIoLS1ib3hlbC1zcC00eHMpIDAgdmFyKC0tYm94ZWwtc3AtNHhzKSB2YXIoLS1ib3hlbC1zcC14cyk7CiAgfQogIC5zcGVjLXRpdGxlLWlucHV0W2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtMWRjODE0OWM3OV06OnBsYWNlaG9sZGVyIHsKICAgIGNvbG9yOiB2YXIoLS1ib3hlbC00MDApOwogIH0K.glimmer-scoped.css";
import "./spec.gts.CiAgLnNwZWMtZGVzY3JpcHRpb24taW5wdXRbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS03OWVkZjMwZDA1XSB7CiAgICBwYWRkaW5nOiB2YXIoLS1ib3hlbC1zcC00eHMpIDAgdmFyKC0tYm94ZWwtc3AtNHhzKSB2YXIoLS1ib3hlbC1zcC14cyk7CiAgfQogIC5zcGVjLWRlc2NyaXB0aW9uLWlucHV0W2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtNzllZGYzMGQwNV06OnBsYWNlaG9sZGVyIHsKICAgIGNvbG9yOiB2YXIoLS1ib3hlbC00MDApOwogIH0K.glimmer-scoped.css";
import "./spec.gts.CiAgLmVtYmVkZGVkLXNwZWNbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS05ZTQ1ODI5MGVmXSB7CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGdhcDogdmFyKC0tYm94ZWwtc3Atc20pOwogICAgcGFkZGluZzogdmFyKC0tYm94ZWwtc3AteHMpOwogIH0KICAuaGVhZGVyLWljb24tY29udGFpbmVyW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtOWU0NTgyOTBlZl0gewogICAgZmxleC1zaHJpbms6IDA7CiAgICBoZWlnaHQ6IHZhcigtLWJveGVsLWljb24teGwpOwogICAgd2lkdGg6IHZhcigtLWJveGVsLWljb24teGwpOwogICAgZGlzcGxheTogZmxleDsKICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsKICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJveGVsLTEwMCk7CiAgICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3hlbC1ib3JkZXItY29sb3IpOwogICAgYm9yZGVyLXJhZGl1czogdmFyKC0tYm94ZWwtYm9yZGVyLXJhZGl1cy1sZyk7CiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ib3hlbC1saWdodCk7CiAgfQogIC5oZWFkZXItaW5mby1jb250YWluZXJbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS05ZTQ1ODI5MGVmXSB7CiAgICBmbGV4OiAxOwogIH0KICAudGl0bGVbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS05ZTQ1ODI5MGVmXSB7CiAgICBtYXJnaW46IDA7CiAgICBmb250OiA2MDAgdmFyKC0tYm94ZWwtZm9udC1zbSk7CiAgICBsZXR0ZXItc3BhY2luZzogdmFyKC0tYm94ZWwtbHNwLXhzKTsKICB9CiAgLmRlc2NyaXB0aW9uW2RhdGEtc2NvcGVkY3NzLTFmMmUwZGJhNGEtOWU0NTgyOTBlZl0gewogICAgbWFyZ2luOiAwOwogICAgY29sb3I6IHZhcigtLWJveGVsLTUwMCk7CiAgICBmb250OiB2YXIoLS1ib3hlbC1mb250LXNpemUteHMpOwogICAgbGV0dGVyLXNwYWNpbmc6IHZhcigtLWJveGVsLWxzcC14cyk7CiAgfQo%3D.glimmer-scoped.css";
import "./spec.gts.CiAgLnNwZWMtdGFnLXBpbGxbZGF0YS1zY29wZWRjc3MtMWYyZTBkYmE0YS02NzU5Nzg5Y2QxXSB7CiAgICAtLXBpbGwtZm9udDogNTAwIHZhcigtLWJveGVsLWZvbnQteHMpOwogICAgLS1waWxsLWJhY2tncm91bmQtY29sb3I6IHZhcigtLWJveGVsLTIwMCk7CiAgICAtLXBpbGwtaWNvbi1zaXplOiAxOHB4OwogICAgd29yZC1icmVhazogaW5pdGlhbDsKICAgIHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7CiAgfQo%3D.glimmer-scoped.css";
class PopulateFieldSpecExampleCommand extends PopulateWithSampleDataCommand {
  constructor(commandContext) {
    super(commandContext);
  }
  get prompt() {
    return `Fill in sample data for this example on the card's spec.`;
  }
  getAttachedFileURLs(card) {
    let codeRef = card.ref;
    if (!codeRef) {
      return [];
    }
    codeRef = codeRefWithAbsoluteURL(codeRef, cardIdToURL(card.id));
    let cardOrFieldModuleURL = codeRef.module ? ensureExtension(codeRef.module, {
      default: '.gts'
    }) : undefined;
    return cardOrFieldModuleURL ? [cardOrFieldModuleURL] : [];
  }
}
class GenerateExamplesForFieldSpecCommand extends GenerateExampleCardsCommand {
  constructor(commandContext) {
    super(commandContext);
  }
  getPrompt(count) {
    return `Generate ${count} additional examples on this card's spec.`;
  }
}
const GENERATED_EXAMPLE_COUNT = 3;
class SpecTypeField extends StringField {
  static displayName = 'Spec Type';
}
const PRIMITIVE_INCOMPATIBILITY_MESSAGE = 'Examples are not currently supported for primitive fields';
// Exported Header Component

export class SpecHeader extends GlimmerComponent {
  get defaultIcon() {
    if (!this.args.model) {
      return;
    }
    return this.args.model.constructor?.icon;
  }
  get icon() {
    return this.cardDef?.icon;
  }
  static {
    dt7948.g(this.prototype, "loadCardDef", [use], function () {
      return resource(() => {
        let cardDefObj = new TrackedObject({
          value: undefined
        });
        (async () => {
          try {
            if (this.args.model.ref && this.args.model.id) {
              let cardDef = await loadCardDef(this.args.model.ref, {
                loader: myLoader(),
                relativeTo: cardIdToURL(this.args.model.id)
              });
              cardDefObj.value = cardDef;
            }
          } catch (e) {
            cardDefObj.value = undefined;
          }
        })();
        return cardDefObj;
      });
    });
  }
  #loadCardDef = (dt7948.i(this, "loadCardDef"), void 0);
  get cardDef() {
    return this.loadCardDef.value;
  }
  static {
    setComponentTemplate(createTemplateFactory(
    /*
      <header class='header' aria-labelledby='title'>
      <div class='box header-icon-container'>
        {{#if this.icon}}
          <this.icon width='35' height='35' role='presentation' />
        {{else if this.defaultIcon}}
          <this.defaultIcon width='35' height='35' role='presentation' />
        {{/if}}
      </div>
      <div class='header-info-container'>
        {{#if @isEditMode}}
          <div class='header-title-container' data-test-title>
            <label for='spec-title' class='boxel-sr-only'>Title</label>
            {{yield to='title'}}
          </div>
          <div class='header-description-container' data-test-description>
            <label
              for='spec-description'
              class='boxel-sr-only'
            >Description</label>
            {{yield to='description'}}
          </div>
        {{else}}
          <h1 class='title' id='title' data-test-title>
            {{yield to='title'}}
          </h1>
          <p class='description' data-test-description>
            {{yield to='description'}}
          </p>
        {{/if}}
      </div>
    </header>
    <style scoped>
      .box {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--boxel-light);
      }
      .header {
        display: flex;
        gap: var(--boxel-sp-sm);
      }
      .header-icon-container {
        flex-shrink: 0;
        height: var(--boxel-icon-xxl);
        width: var(--boxel-icon-xxl);
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--boxel-100);
      }
      .header-info-container {
        flex: 1;
        align-self: center;
      }
      /* Edit mode specific styles *\/
      .header-info-container:has(.header-title-container) {
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
      }
      .header-info-container > div + div {
        border-top: 1px solid var(--boxel-spec-background-color);
      }
      .header-title-container,
      .header-description-container {
        padding: var(--boxel-sp-xs);
      }
      /* Isolated mode specific styles *\/
      h1.title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        letter-spacing: var(--boxel-lsp-xs);
        line-height: 1.2;
      }
      p.description {
        margin-top: var(--boxel-sp-4xs);
        margin-bottom: 0;
      }
      .title,
      .description {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        text-wrap: pretty;
      }
    </style>
    */
    {
      "id": "itOPYcuK",
      "block": "[[[10,\"header\"],[14,0,\"header\"],[14,\"aria-labelledby\",\"title\"],[14,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"],[12],[1,\"\\n  \"],[10,0],[14,0,\"box header-icon-container\"],[14,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"],[12],[1,\"\\n\"],[41,[30,0,[\"icon\"]],[[[1,\"      \"],[8,[30,0,[\"icon\"]],[[24,\"width\",\"35\"],[24,\"height\",\"35\"],[24,\"role\",\"presentation\"],[24,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"]],null,null],[1,\"\\n\"]],[]],[[[41,[30,0,[\"defaultIcon\"]],[[[1,\"      \"],[8,[30,0,[\"defaultIcon\"]],[[24,\"width\",\"35\"],[24,\"height\",\"35\"],[24,\"role\",\"presentation\"],[24,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"]],null,null],[1,\"\\n    \"]],[]],null]],[]]],[1,\"  \"],[13],[1,\"\\n  \"],[10,0],[14,0,\"header-info-container\"],[14,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"],[12],[1,\"\\n\"],[41,[30,1],[[[1,\"      \"],[10,0],[14,0,\"header-title-container\"],[14,\"data-test-title\",\"\"],[14,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"],[12],[1,\"\\n        \"],[10,\"label\"],[14,\"for\",\"spec-title\"],[14,0,\"boxel-sr-only\"],[14,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"],[12],[1,\"Title\"],[13],[1,\"\\n        \"],[18,2,null],[1,\"\\n      \"],[13],[1,\"\\n      \"],[10,0],[14,0,\"header-description-container\"],[14,\"data-test-description\",\"\"],[14,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"],[12],[1,\"\\n        \"],[10,\"label\"],[14,\"for\",\"spec-description\"],[14,0,\"boxel-sr-only\"],[14,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"],[12],[1,\"Description\"],[13],[1,\"\\n        \"],[18,3,null],[1,\"\\n      \"],[13],[1,\"\\n\"]],[]],[[[1,\"      \"],[10,\"h1\"],[14,0,\"title\"],[14,1,\"title\"],[14,\"data-test-title\",\"\"],[14,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"],[12],[1,\"\\n        \"],[18,2,null],[1,\"\\n      \"],[13],[1,\"\\n      \"],[10,2],[14,0,\"description\"],[14,\"data-test-description\",\"\"],[14,\"data-scopedcss-1f2e0dba4a-52984aff94\",\"\"],[12],[1,\"\\n        \"],[18,3,null],[1,\"\\n      \"],[13],[1,\"\\n\"]],[]]],[1,\"  \"],[13],[1,\"\\n\"],[13],[1,\"\\n\"]],[\"@isEditMode\",\"&title\",\"&description\"],[\"if\",\"yield\"]]",
      "moduleName": "packages/runtime-common/spec.gts",
      "isStrictMode": true
    }), this);
  }
}
// Exported Readme Section Component

export class SpecReadmeSection extends GlimmerComponent {
  generateReadme() {
    this.generateReadmeTask.perform();
  }
  static {
    dt7948.n(this.prototype, "generateReadme", [action]);
  }
  generateReadmeTask = _buildTask(() => ({
    context: this,
    generator: function* () {
      if (!this.args.model) {
        return;
      }
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        console.error('Command context not available');
        return;
      }
      try {
        const generateReadmeSpecCommand = new GenerateReadmeSpecCommand(commandContext);
        yield generateReadmeSpecCommand.execute({
          spec: this.args.model
        });
      } catch (error) {
        console.error('Error generating README:', error);
      }
    }
  }), null, "generateReadmeTask", null);
  static {
    setComponentTemplate(createTemplateFactory(
    /*
      <section class='readme section'>
      <header class='row-header' aria-labelledby='readme'>
        <div class='row-header-left'>
          <BookOpenText width='20' height='20' role='presentation' />
          <h2 id='readme'>Read Me</h2>
        </div>
        {{#if @isEditMode}}
          <BoxelButton
            @kind='primary'
            @size='extra-small'
            @loading={{this.generateReadmeTask.isRunning}}
            {{on 'click' this.generateReadme}}
            data-test-generate-readme
          >
            {{#if this.generateReadmeTask.isRunning}}
              Generating...
            {{else}}
              Generate README
            {{/if}}
          </BoxelButton>
        {{/if}}
      </header>
      <div data-test-readme>
        {{yield}}
      </div>
    </section>
    <style scoped>
      .section {
        margin-top: var(--boxel-sp);
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--boxel-400);
      }
      h2 {
        margin: 0;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .row-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-lg);
      }
      .row-header-left {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
    </style>
    */
    {
      "id": "Ynlk0yTm",
      "block": "[[[10,\"section\"],[14,0,\"readme section\"],[14,\"data-scopedcss-1f2e0dba4a-c74d324c24\",\"\"],[12],[1,\"\\n  \"],[10,\"header\"],[14,0,\"row-header\"],[14,\"aria-labelledby\",\"readme\"],[14,\"data-scopedcss-1f2e0dba4a-c74d324c24\",\"\"],[12],[1,\"\\n    \"],[10,0],[14,0,\"row-header-left\"],[14,\"data-scopedcss-1f2e0dba4a-c74d324c24\",\"\"],[12],[1,\"\\n      \"],[8,[32,0],[[24,\"width\",\"20\"],[24,\"height\",\"20\"],[24,\"role\",\"presentation\"],[24,\"data-scopedcss-1f2e0dba4a-c74d324c24\",\"\"]],null,null],[1,\"\\n      \"],[10,\"h2\"],[14,1,\"readme\"],[14,\"data-scopedcss-1f2e0dba4a-c74d324c24\",\"\"],[12],[1,\"Read Me\"],[13],[1,\"\\n    \"],[13],[1,\"\\n\"],[41,[30,1],[[[1,\"      \"],[8,[32,1],[[24,\"data-test-generate-readme\",\"\"],[24,\"data-scopedcss-1f2e0dba4a-c74d324c24\",\"\"],[4,[32,2],[\"click\",[30,0,[\"generateReadme\"]]],null]],[[\"@kind\",\"@size\",\"@loading\"],[\"primary\",\"extra-small\",[30,0,[\"generateReadmeTask\",\"isRunning\"]]]],[[\"default\"],[[[[1,\"\\n\"],[41,[30,0,[\"generateReadmeTask\",\"isRunning\"]],[[[1,\"          Generating...\\n\"]],[]],[[[1,\"          Generate README\\n\"]],[]]],[1,\"      \"]],[]]]]],[1,\"\\n\"]],[]],null],[1,\"  \"],[13],[1,\"\\n  \"],[10,0],[14,\"data-test-readme\",\"\"],[14,\"data-scopedcss-1f2e0dba4a-c74d324c24\",\"\"],[12],[1,\"\\n    \"],[18,2,null],[1,\"\\n  \"],[13],[1,\"\\n\"],[13],[1,\"\\n\"]],[\"@isEditMode\",\"&default\"],[\"if\",\"yield\"]]",
      "moduleName": "packages/runtime-common/spec.gts",
      "scope": () => [BookOpenText, BoxelButton, on],
      "isStrictMode": true
    }), this);
  }
}
// Exported Examples Section Component

export class SpecExamplesSection extends GlimmerComponent {
  get specType() {
    return this.args.model.specType;
  }
  get isPrimitiveField() {
    return isPrimitive(this.cardDef);
  }
  static {
    dt7948.g(this.prototype, "loadCardDef", [use], function () {
      return resource(() => {
        let cardDefObj = new TrackedObject({
          value: undefined
        });
        (async () => {
          try {
            if (this.args.model.ref && this.args.model.id) {
              let cardDef = await loadCardDef(this.args.model.ref, {
                loader: myLoader(),
                relativeTo: cardIdToURL(this.args.model.id)
              });
              cardDefObj.value = cardDef;
            }
          } catch (e) {
            cardDefObj.value = undefined;
          }
        })();
        return cardDefObj;
      });
    });
  }
  #loadCardDef = (dt7948.i(this, "loadCardDef"), void 0);
  get cardDef() {
    return this.loadCardDef.value;
  }
  static {
    setComponentTemplate(createTemplateFactory(
    /*
      <section class='examples section'>
      <header class='row-header' aria-labelledby='examples'>
        <div class='row-header-left'>
          <LayersSubtract width='20' height='20' role='presentation' />
          <h2 id='examples'>Examples</h2>
        </div>
      </header>
      {{#if (eq this.specType 'field')}}
        {{#if this.isPrimitiveField}}
          <p
            class='spec-example-incompatible-message'
            data-test-spec-example-incompatible-primitives
          >
            <span>{{PRIMITIVE_INCOMPATIBILITY_MESSAGE}}</span>
          </p>
        {{else}}
          {{yield to='containedExamples'}}
        {{/if}}
      {{else}}
        {{yield to='linkedExamples'}}
      {{/if}}
    </section>
    <style scoped>
      .section {
        margin-top: var(--boxel-sp);
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--boxel-400);
      }
      h2 {
        margin: 0;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .row-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-lg);
      }
      .row-header-left {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .spec-example-incompatible-message {
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        font-weight: 500;
        margin-block: 0;
      }
    </style>
    */
    {
      "id": "N+57OQcN",
      "block": "[[[10,\"section\"],[14,0,\"examples section\"],[14,\"data-scopedcss-1f2e0dba4a-b3ae79a17a\",\"\"],[12],[1,\"\\n  \"],[10,\"header\"],[14,0,\"row-header\"],[14,\"aria-labelledby\",\"examples\"],[14,\"data-scopedcss-1f2e0dba4a-b3ae79a17a\",\"\"],[12],[1,\"\\n    \"],[10,0],[14,0,\"row-header-left\"],[14,\"data-scopedcss-1f2e0dba4a-b3ae79a17a\",\"\"],[12],[1,\"\\n      \"],[8,[32,0],[[24,\"width\",\"20\"],[24,\"height\",\"20\"],[24,\"role\",\"presentation\"],[24,\"data-scopedcss-1f2e0dba4a-b3ae79a17a\",\"\"]],null,null],[1,\"\\n      \"],[10,\"h2\"],[14,1,\"examples\"],[14,\"data-scopedcss-1f2e0dba4a-b3ae79a17a\",\"\"],[12],[1,\"Examples\"],[13],[1,\"\\n    \"],[13],[1,\"\\n  \"],[13],[1,\"\\n\"],[41,[28,[32,1],[[30,0,[\"specType\"]],\"field\"],null],[[[41,[30,0,[\"isPrimitiveField\"]],[[[1,\"      \"],[10,2],[14,0,\"spec-example-incompatible-message\"],[14,\"data-test-spec-example-incompatible-primitives\",\"\"],[14,\"data-scopedcss-1f2e0dba4a-b3ae79a17a\",\"\"],[12],[1,\"\\n        \"],[10,1],[14,\"data-scopedcss-1f2e0dba4a-b3ae79a17a\",\"\"],[12],[1,[32,2]],[13],[1,\"\\n      \"],[13],[1,\"\\n\"]],[]],[[[1,\"      \"],[18,1,null],[1,\"\\n\"]],[]]]],[]],[[[1,\"    \"],[18,2,null],[1,\"\\n\"]],[]]],[13],[1,\"\\n\"]],[\"&containedExamples\",\"&linkedExamples\"],[\"if\",\"yield\"]]",
      "moduleName": "packages/runtime-common/spec.gts",
      "scope": () => [LayersSubtract, eq, PRIMITIVE_INCOMPATIBILITY_MESSAGE],
      "isStrictMode": true
    }), this);
  }
}
// This component (ExamplesWithInteractive) renders interactive examples for field configuration, shown only in subclass spec UIs.
// It allows users to interact with the field examples in the UI, but does not permit any data to be written to the server—even if users lack write permissions.

export class ExamplesWithInteractive extends GlimmerComponent {
  get permissions() {
    return {
      canWrite: true,
      canRead: true
    };
  }
  static {
    dt7948.n(this.prototype, "permissions", [provide(PermissionsContextName)]);
  }
  static {
    setComponentTemplate(createTemplateFactory(
    /*
      <section class='examples-with-interactive-preview section'>
      <header
        class='row-header'
        aria-labelledby='examples-with-interactive-preview'
      >
        <div class='row-header-left'>
          <LayoutList width='20' height='20' role='presentation' />
          <h2 id='examples-with-interactive-preview'>Field Usage Examples</h2>
        </div>
      </header>
      <div class='examples-with-interactive-grid'>
        {{yield}}
      </div>
    </section>
    <style scoped>
      .section {
        margin-top: var(--boxel-sp);
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--boxel-400);
      }
      h2 {
        margin: 0;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .row-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-lg);
      }
      .row-header-left {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .examples-with-interactive-preview {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .examples-with-interactive-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: var(--boxel-sp);
      }
      .examples-with-interactive-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
    </style>
    */
    {
      "id": "DrV9g6R7",
      "block": "[[[10,\"section\"],[14,0,\"examples-with-interactive-preview section\"],[14,\"data-scopedcss-1f2e0dba4a-a64017c164\",\"\"],[12],[1,\"\\n  \"],[10,\"header\"],[14,0,\"row-header\"],[14,\"aria-labelledby\",\"examples-with-interactive-preview\"],[14,\"data-scopedcss-1f2e0dba4a-a64017c164\",\"\"],[12],[1,\"\\n    \"],[10,0],[14,0,\"row-header-left\"],[14,\"data-scopedcss-1f2e0dba4a-a64017c164\",\"\"],[12],[1,\"\\n      \"],[8,[32,0],[[24,\"width\",\"20\"],[24,\"height\",\"20\"],[24,\"role\",\"presentation\"],[24,\"data-scopedcss-1f2e0dba4a-a64017c164\",\"\"]],null,null],[1,\"\\n      \"],[10,\"h2\"],[14,1,\"examples-with-interactive-preview\"],[14,\"data-scopedcss-1f2e0dba4a-a64017c164\",\"\"],[12],[1,\"Field Usage Examples\"],[13],[1,\"\\n    \"],[13],[1,\"\\n  \"],[13],[1,\"\\n  \"],[10,0],[14,0,\"examples-with-interactive-grid\"],[14,\"data-scopedcss-1f2e0dba4a-a64017c164\",\"\"],[12],[1,\"\\n    \"],[18,1,null],[1,\"\\n  \"],[13],[1,\"\\n\"],[13],[1,\"\\n\"]],[\"&default\"],[\"yield\"]]",
      "moduleName": "packages/runtime-common/spec.gts",
      "scope": () => [LayoutList],
      "isStrictMode": true
    }), this);
  }
}
// Exported Module Section Component

export class SpecModuleSection extends GlimmerComponent {
  get realmInfo() {
    return getCardMeta(this.args.model, 'realmInfo');
  }
  get moduleHref() {
    return this.args.model.moduleHref;
  }
  get refName() {
    return this.args.model.ref?.name;
  }
  get specType() {
    return this.args.model.specType;
  }
  static {
    setComponentTemplate(createTemplateFactory(
    /*
      <section class='module section'>
      <header class='row-header' aria-labelledby='module'>
        <div class='row-header-left'>
          <GitBranch width='20' height='20' role='presentation' />
          <h2 id='module'>Module</h2>
        </div>
      </header>
      <div class='code-ref-container'>
        <FieldContainer @label='URL' @vertical={{true}} @labelFontSize='small'>
          <div class='code-ref-row'>
            <RealmIcon class='realm-icon' @realmInfo={{this.realmInfo}} />
            <span class='code-ref-value' data-test-module-href>
              {{this.moduleHref}}
            </span>
          </div>
        </FieldContainer>
        <FieldContainer
          @label='Module Name'
          @vertical={{true}}
          @labelFontSize='small'
        >
          <div class='code-ref-row'>
            <ExportArrow class='exported-arrow' width='10' height='10' />
            <div class='code-ref-value' data-test-exported-name>
              {{this.refName}}
            </div>
            <div class='exported-type' data-test-exported-type>
              {{this.specType}}
            </div>
          </div>
        </FieldContainer>
      </div>
    </section>
    <style scoped>
      .section {
        margin-top: var(--boxel-sp);
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--boxel-400);
      }
      h2 {
        margin: 0;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .row-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-lg);
      }
      .row-header-left {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .code-ref-container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .code-ref-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-height: var(--boxel-form-control-height);
        padding: var(--boxel-sp-xs);
        background-color: var(
          --boxel-spec-code-ref-background-color,
          var(--boxel-100)
        );
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        color: var(--boxel-spec-code-ref-text-color, var(--boxel-450));
      }
      .code-ref-value {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .exported-type {
        margin-left: auto;
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp);
        text-transform: uppercase;
      }
      .exported-arrow {
        min-width: 8px;
        min-height: 8px;
      }
      .realm-icon {
        width: 18px;
        height: 18px;
        border: 1px solid var(--boxel-dark);
      }
    </style>
    */
    {
      "id": "PNsea1cT",
      "block": "[[[10,\"section\"],[14,0,\"module section\"],[14,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"],[12],[1,\"\\n  \"],[10,\"header\"],[14,0,\"row-header\"],[14,\"aria-labelledby\",\"module\"],[14,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"],[12],[1,\"\\n    \"],[10,0],[14,0,\"row-header-left\"],[14,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"],[12],[1,\"\\n      \"],[8,[32,0],[[24,\"width\",\"20\"],[24,\"height\",\"20\"],[24,\"role\",\"presentation\"],[24,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"]],null,null],[1,\"\\n      \"],[10,\"h2\"],[14,1,\"module\"],[14,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"],[12],[1,\"Module\"],[13],[1,\"\\n    \"],[13],[1,\"\\n  \"],[13],[1,\"\\n  \"],[10,0],[14,0,\"code-ref-container\"],[14,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"],[12],[1,\"\\n    \"],[8,[32,1],[[24,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"]],[[\"@label\",\"@vertical\",\"@labelFontSize\"],[\"URL\",true,\"small\"]],[[\"default\"],[[[[1,\"\\n      \"],[10,0],[14,0,\"code-ref-row\"],[14,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"],[12],[1,\"\\n        \"],[8,[32,2],[[24,0,\"realm-icon\"],[24,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"]],[[\"@realmInfo\"],[[30,0,[\"realmInfo\"]]]],null],[1,\"\\n        \"],[10,1],[14,0,\"code-ref-value\"],[14,\"data-test-module-href\",\"\"],[14,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"],[12],[1,\"\\n          \"],[1,[30,0,[\"moduleHref\"]]],[1,\"\\n        \"],[13],[1,\"\\n      \"],[13],[1,\"\\n    \"]],[]]]]],[1,\"\\n    \"],[8,[32,1],[[24,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"]],[[\"@label\",\"@vertical\",\"@labelFontSize\"],[\"Module Name\",true,\"small\"]],[[\"default\"],[[[[1,\"\\n      \"],[10,0],[14,0,\"code-ref-row\"],[14,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"],[12],[1,\"\\n        \"],[8,[32,3],[[24,0,\"exported-arrow\"],[24,\"width\",\"10\"],[24,\"height\",\"10\"],[24,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"]],null,null],[1,\"\\n        \"],[10,0],[14,0,\"code-ref-value\"],[14,\"data-test-exported-name\",\"\"],[14,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"],[12],[1,\"\\n          \"],[1,[30,0,[\"refName\"]]],[1,\"\\n        \"],[13],[1,\"\\n        \"],[10,0],[14,0,\"exported-type\"],[14,\"data-test-exported-type\",\"\"],[14,\"data-scopedcss-1f2e0dba4a-a09b32d675\",\"\"],[12],[1,\"\\n          \"],[1,[30,0,[\"specType\"]]],[1,\"\\n        \"],[13],[1,\"\\n      \"],[13],[1,\"\\n    \"]],[]]]]],[1,\"\\n  \"],[13],[1,\"\\n\"],[13],[1,\"\\n\"]],[],[]]",
      "moduleName": "packages/runtime-common/spec.gts",
      "scope": () => [GitBranch, FieldContainer, RealmIcon, ExportArrow],
      "isStrictMode": true
    }), this);
  }
}
class Isolated extends Component {
  get absoluteRef() {
    if (!this.args.model.ref || !this.args.model.id) {
      return undefined;
    }
    let url = cardIdToURL(this.args.model.id);
    let ref = codeRefWithAbsoluteURL(this.args.model.ref, url);
    if (!isResolvedCodeRef(ref)) {
      throw new Error('ref is not a resolved code ref');
    }
    return ref;
  }
  static {
    setComponentTemplate(createTemplateFactory(
    /*
      <article class='container'>
      <SpecHeader @model={{@model}}>
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>
    
      <SpecReadmeSection @model={{@model}} @context={{@context}}>
        <@fields.readMe />
      </SpecReadmeSection>
    
      <SpecExamplesSection @model={{@model}}>
        <:linkedExamples>
          <@fields.linkedExamples />
        </:linkedExamples>
        <:containedExamples>
          <@fields.containedExamples />
        </:containedExamples>
      </SpecExamplesSection>
    
      <SpecModuleSection @model={{@model}} />
    </article>
    <style scoped>
      .container {
        --boxel-spec-background-color: #ebeaed;
        --boxel-spec-code-ref-background-color: #e2e2e2;
        --boxel-spec-code-ref-text-color: #646464;
    
        height: 100%;
        min-height: max-content;
        padding: var(--boxel-sp);
        background-color: var(--boxel-spec-background-color);
      }
    </style>
    */
    {
      "id": "asOQWfFq",
      "block": "[[[10,\"article\"],[14,0,\"container\"],[14,\"data-scopedcss-1f2e0dba4a-1b82ba6681\",\"\"],[12],[1,\"\\n  \"],[8,[32,0],[[24,\"data-scopedcss-1f2e0dba4a-1b82ba6681\",\"\"]],[[\"@model\"],[[30,1]]],[[\"title\",\"description\"],[[[[8,[30,2,[\"cardTitle\"]],[[24,\"data-scopedcss-1f2e0dba4a-1b82ba6681\",\"\"]],null,null]],[]],[[[8,[30,2,[\"cardDescription\"]],[[24,\"data-scopedcss-1f2e0dba4a-1b82ba6681\",\"\"]],null,null]],[]]]]],[1,\"\\n\\n  \"],[8,[32,1],[[24,\"data-scopedcss-1f2e0dba4a-1b82ba6681\",\"\"]],[[\"@model\",\"@context\"],[[30,1],[30,3]]],[[\"default\"],[[[[1,\"\\n    \"],[8,[30,2,[\"readMe\"]],[[24,\"data-scopedcss-1f2e0dba4a-1b82ba6681\",\"\"]],null,null],[1,\"\\n  \"]],[]]]]],[1,\"\\n\\n  \"],[8,[32,2],[[24,\"data-scopedcss-1f2e0dba4a-1b82ba6681\",\"\"]],[[\"@model\"],[[30,1]]],[[\"linkedExamples\",\"containedExamples\"],[[[[1,\"\\n      \"],[8,[30,2,[\"linkedExamples\"]],[[24,\"data-scopedcss-1f2e0dba4a-1b82ba6681\",\"\"]],null,null],[1,\"\\n    \"]],[]],[[[1,\"\\n      \"],[8,[30,2,[\"containedExamples\"]],[[24,\"data-scopedcss-1f2e0dba4a-1b82ba6681\",\"\"]],null,null],[1,\"\\n    \"]],[]]]]],[1,\"\\n\\n  \"],[8,[32,3],[[24,\"data-scopedcss-1f2e0dba4a-1b82ba6681\",\"\"]],[[\"@model\"],[[30,1]]],null],[1,\"\\n\"],[13],[1,\"\\n\"]],[\"@model\",\"@fields\",\"@context\"],[]]",
      "moduleName": "packages/runtime-common/spec.gts",
      "scope": () => [SpecHeader, SpecReadmeSection, SpecExamplesSection, SpecModuleSection],
      "isStrictMode": true
    }), this);
  }
}
class Fitted extends Component {
  get defaultIcon() {
    if (!this.args.model) {
      return;
    }
    return this.args.model.constructor?.icon;
  }
  get icon() {
    return this.loadCardIcon.value;
  }
  static {
    dt7948.g(this.prototype, "loadCardIcon", [use], function () {
      return resource(() => {
        let icon = new TrackedObject({
          value: undefined
        });
        (async () => {
          try {
            if (this.args.model.ref && this.args.model.id) {
              let card = await loadCardDef(this.args.model.ref, {
                loader: myLoader(),
                relativeTo: cardIdToURL(this.args.model.id)
              });
              icon.value = card.icon;
            }
          } catch (e) {
            icon.value = undefined;
          }
        })();
        return icon;
      });
    });
  }
  #loadCardIcon = (dt7948.i(this, "loadCardIcon"), void 0);
  static {
    setComponentTemplate(createTemplateFactory(
    /*
      <BasicFitted
      class='spec-fitted'
      @primary={{@model.cardTitle}}
      @secondary={{@model.cardDescription}}
    >
      <:thumbnail>
        {{#if this.icon}}
          <this.icon width='35' height='35' role='presentation' />
        {{else if this.defaultIcon}}
          <this.defaultIcon width='35' height='35' role='presentation' />
        {{/if}}
      </:thumbnail>
      <:default>
        {{#if @model.specType}}
          <SpecTag @specType={{@model.specType}} />
        {{/if}}
      </:default>
    </BasicFitted>
    <style scoped>
      @layer {
        .spec-fitted {
          align-items: center;
        }
      }
    </style>
    */
    {
      "id": "iO7PGiex",
      "block": "[[[8,[32,0],[[24,0,\"spec-fitted\"],[24,\"data-scopedcss-1f2e0dba4a-c6aebd78bb\",\"\"]],[[\"@primary\",\"@secondary\"],[[30,1,[\"cardTitle\"]],[30,1,[\"cardDescription\"]]]],[[\"thumbnail\",\"default\"],[[[[1,\"\\n\"],[41,[30,0,[\"icon\"]],[[[1,\"      \"],[8,[30,0,[\"icon\"]],[[24,\"width\",\"35\"],[24,\"height\",\"35\"],[24,\"role\",\"presentation\"],[24,\"data-scopedcss-1f2e0dba4a-c6aebd78bb\",\"\"]],null,null],[1,\"\\n\"]],[]],[[[41,[30,0,[\"defaultIcon\"]],[[[1,\"      \"],[8,[30,0,[\"defaultIcon\"]],[[24,\"width\",\"35\"],[24,\"height\",\"35\"],[24,\"role\",\"presentation\"],[24,\"data-scopedcss-1f2e0dba4a-c6aebd78bb\",\"\"]],null,null],[1,\"\\n    \"]],[]],null]],[]]],[1,\"  \"]],[]],[[[1,\"\\n\"],[41,[30,1,[\"specType\"]],[[[1,\"      \"],[8,[32,1],[[24,\"data-scopedcss-1f2e0dba4a-c6aebd78bb\",\"\"]],[[\"@specType\"],[[30,1,[\"specType\"]]]],null],[1,\"\\n\"]],[]],null],[1,\"  \"]],[]]]]],[1,\"\\n\"]],[\"@model\"],[\"if\"]]",
      "moduleName": "packages/runtime-common/spec.gts",
      "scope": () => [BasicFitted, SpecTag],
      "isStrictMode": true
    }), this);
  }
}
class Edit extends Component {
  get absoluteRef() {
    if (!this.args.model.ref || !this.args.model.id) {
      return undefined;
    }
    let url = cardIdToURL(this.args.model.id);
    let ref = codeRefWithAbsoluteURL(this.args.model.ref, url);
    if (!isResolvedCodeRef(ref)) {
      throw new Error('ref is not a resolved code ref');
    }
    return ref;
  }
  static {
    setComponentTemplate(createTemplateFactory(
    /*
      <article class='container'>
      <SpecHeader @model={{@model}} @isEditMode={{true}}>
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>
    
      <SpecReadmeSection
        @model={{@model}}
        @context={{@context}}
        @isEditMode={{@canEdit}}
      >
        <@fields.readMe />
      </SpecReadmeSection>
    
      <SpecExamplesSection @model={{@model}}>
        <:linkedExamples>
          <@fields.linkedExamples @typeConstraint={{this.absoluteRef}} />
        </:linkedExamples>
        <:containedExamples>
          <@fields.containedExamples @typeConstraint={{this.absoluteRef}} />
        </:containedExamples>
      </SpecExamplesSection>
    
      <SpecModuleSection @model={{@model}} />
    </article>
    <style scoped>
      .container {
        --boxel-spec-background-color: #ebeaed;
        --boxel-spec-code-ref-background-color: #e2e2e2;
        --boxel-spec-code-ref-text-color: #646464;
    
        height: 100%;
        min-height: max-content;
        padding: var(--boxel-sp);
        background-color: var(--boxel-spec-background-color);
      }
      :deep(.add-new) {
        border: 1px solid var(--border, var(--boxel-border-color));
      }
    </style>
    */
    {
      "id": "0MSLHd3N",
      "block": "[[[10,\"article\"],[14,0,\"container\"],[14,\"data-scopedcss-1f2e0dba4a-8d3e623300\",\"\"],[12],[1,\"\\n  \"],[8,[32,0],[[24,\"data-scopedcss-1f2e0dba4a-8d3e623300\",\"\"]],[[\"@model\",\"@isEditMode\"],[[30,1],true]],[[\"title\",\"description\"],[[[[8,[30,2,[\"cardTitle\"]],[[24,\"data-scopedcss-1f2e0dba4a-8d3e623300\",\"\"]],null,null]],[]],[[[8,[30,2,[\"cardDescription\"]],[[24,\"data-scopedcss-1f2e0dba4a-8d3e623300\",\"\"]],null,null]],[]]]]],[1,\"\\n\\n  \"],[8,[32,1],[[24,\"data-scopedcss-1f2e0dba4a-8d3e623300\",\"\"]],[[\"@model\",\"@context\",\"@isEditMode\"],[[30,1],[30,3],[30,4]]],[[\"default\"],[[[[1,\"\\n    \"],[8,[30,2,[\"readMe\"]],[[24,\"data-scopedcss-1f2e0dba4a-8d3e623300\",\"\"]],null,null],[1,\"\\n  \"]],[]]]]],[1,\"\\n\\n  \"],[8,[32,2],[[24,\"data-scopedcss-1f2e0dba4a-8d3e623300\",\"\"]],[[\"@model\"],[[30,1]]],[[\"linkedExamples\",\"containedExamples\"],[[[[1,\"\\n      \"],[8,[30,2,[\"linkedExamples\"]],[[24,\"data-scopedcss-1f2e0dba4a-8d3e623300\",\"\"]],[[\"@typeConstraint\"],[[30,0,[\"absoluteRef\"]]]],null],[1,\"\\n    \"]],[]],[[[1,\"\\n      \"],[8,[30,2,[\"containedExamples\"]],[[24,\"data-scopedcss-1f2e0dba4a-8d3e623300\",\"\"]],[[\"@typeConstraint\"],[[30,0,[\"absoluteRef\"]]]],null],[1,\"\\n    \"]],[]]]]],[1,\"\\n\\n  \"],[8,[32,3],[[24,\"data-scopedcss-1f2e0dba4a-8d3e623300\",\"\"]],[[\"@model\"],[[30,1]]],null],[1,\"\\n\"],[13],[1,\"\\n\"]],[\"@model\",\"@fields\",\"@context\",\"@canEdit\"],[]]",
      "moduleName": "packages/runtime-common/spec.gts",
      "scope": () => [SpecHeader, SpecReadmeSection, SpecExamplesSection, SpecModuleSection],
      "isStrictMode": true
    }), this);
  }
}
class SpecTitleField extends StringField {
  static displayName = 'Spec Title';
  static edit = class Edit extends Component {
    get placeholder() {
      const hasFieldName = Boolean(this.args.fieldName);
      if (hasFieldName) {
        return 'Enter ' + this.args.fieldName;
      }
      return undefined;
    }
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <BoxelInput
        @id='spec-title'
        @value={{@model}}
        @onInput={{@set}}
        @placeholder={{this.placeholder}}
        @disabled={{not @canEdit}}
        class='spec-title-input'
      />
      <style scoped>
        .spec-title-input {
          font-size: 18px;
          font-weight: 600;
          letter-spacing: var(--boxel-lsp-xs);
          padding: var(--boxel-sp-4xs) 0 var(--boxel-sp-4xs) var(--boxel-sp-xs);
        }
        .spec-title-input::placeholder {
          color: var(--boxel-400);
        }
      </style>
      */
      {
        "id": "ponVqECi",
        "block": "[[[8,[32,0],[[24,0,\"spec-title-input\"],[24,\"data-scopedcss-1f2e0dba4a-1dc8149c79\",\"\"]],[[\"@id\",\"@value\",\"@onInput\",\"@placeholder\",\"@disabled\"],[\"spec-title\",[30,1],[30,2],[30,0,[\"placeholder\"]],[28,[32,1],[[30,3]],null]]],null],[1,\"\\n\"]],[\"@model\",\"@set\",\"@canEdit\"],[]]",
        "moduleName": "packages/runtime-common/spec.gts",
        "scope": () => [BoxelInput, not],
        "isStrictMode": true
      }), this);
    }
  };
}
class SpecDescriptionField extends StringField {
  static displayName = 'Spec Description';
  static edit = class Edit extends Component {
    get placeholder() {
      const hasFieldName = Boolean(this.args.fieldName);
      if (hasFieldName) {
        return 'Enter ' + this.args.fieldName;
      }
      return undefined;
    }
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <BoxelInput
        @id='spec-description'
        @value={{@model}}
        @onInput={{@set}}
        @placeholder={{this.placeholder}}
        @disabled={{not @canEdit}}
        class='spec-description-input'
      />
      <style scoped>
        .spec-description-input {
          padding: var(--boxel-sp-4xs) 0 var(--boxel-sp-4xs) var(--boxel-sp-xs);
        }
        .spec-description-input::placeholder {
          color: var(--boxel-400);
        }
      </style>
      */
      {
        "id": "6JSlAIhq",
        "block": "[[[8,[32,0],[[24,0,\"spec-description-input\"],[24,\"data-scopedcss-1f2e0dba4a-79edf30d05\",\"\"]],[[\"@id\",\"@value\",\"@onInput\",\"@placeholder\",\"@disabled\"],[\"spec-description\",[30,1],[30,2],[30,0,[\"placeholder\"]],[28,[32,1],[[30,3]],null]]],null],[1,\"\\n\"]],[\"@model\",\"@set\",\"@canEdit\"],[]]",
        "moduleName": "packages/runtime-common/spec.gts",
        "scope": () => [BoxelInput, not],
        "isStrictMode": true
      }), this);
    }
  };
}
export class Spec extends CardDef {
  static displayName = 'Spec';
  static [isSpec] = true;
  static icon = BoxModel;
  static {
    dt7948.g(this.prototype, "readMe", [field], function () {
      return contains(MarkdownField);
    });
  }
  #readMe = (dt7948.i(this, "readMe"), void 0);
  static {
    dt7948.g(this.prototype, "ref", [field], function () {
      return contains(CodeRef);
    });
  }
  #ref = (dt7948.i(this, "ref"), void 0);
  static {
    dt7948.g(this.prototype, "specType", [field], function () {
      return contains(SpecTypeField);
    });
  }
  #specType = (dt7948.i(this, "specType"), void 0);
  static {
    dt7948.g(this.prototype, "isField", [field], function () {
      return contains(BooleanField, {
        computeVia: function () {
          return this.specType === 'field';
        }
      });
    });
  }
  #isField = (dt7948.i(this, "isField"), void 0);
  static {
    dt7948.g(this.prototype, "isCard", [field], function () {
      return contains(BooleanField, {
        computeVia: function () {
          return this.specType === 'card' || this.specType === 'app';
        }
      });
    });
  }
  #isCard = (dt7948.i(this, "isCard"), void 0);
  static {
    dt7948.g(this.prototype, "isComponent", [field], function () {
      return contains(BooleanField, {
        computeVia: function () {
          return this.specType === 'component';
        }
      });
    });
  }
  #isComponent = (dt7948.i(this, "isComponent"), void 0);
  static {
    dt7948.g(this.prototype, "moduleHref", [field], function () {
      return contains(StringField, {
        computeVia: function () {
          if (!this.ref || !this.ref.module) {
            return undefined;
          }
          return resolveCardReference(this.ref.module, this.id ?? this[relativeTo]);
        }
      });
    });
  }
  #moduleHref = (dt7948.i(this, "moduleHref"), void 0);
  static {
    dt7948.g(this.prototype, "linkedExamples", [field], function () {
      return linksToMany(CardDef);
    });
  }
  #linkedExamples = (dt7948.i(this, "linkedExamples"), void 0);
  static {
    dt7948.g(this.prototype, "containedExamples", [field], function () {
      return containsMany(FieldDef, {
        isUsed: true
      });
    });
  }
  #containedExamples = (dt7948.i(this, "containedExamples"), void 0);
  static {
    dt7948.g(this.prototype, "cardTitle", [field], function () {
      return contains(SpecTitleField);
    });
  }
  #cardTitle = (dt7948.i(this, "cardTitle"), void 0);
  static {
    dt7948.g(this.prototype, "cardDescription", [field], function () {
      return contains(SpecDescriptionField);
    });
  }
  #cardDescription = (dt7948.i(this, "cardDescription"), void 0);
  [getMenuItems](params) {
    let menuItems = super[getMenuItems](params);
    if (this.specType !== 'field') {
      return menuItems;
    }
    let sampleDataStartIndex = menuItems.findIndex(item => item.tags?.includes('playground-sample-data'));
    let sampleDataItemCount = menuItems.filter(item => item.tags?.includes('playground-sample-data')).length;
    menuItems.splice(sampleDataStartIndex, sampleDataItemCount, ...[{
      label: 'Fill in Sample Data with AI',
      action: async () => {
        await new PopulateFieldSpecExampleCommand(params.commandContext).execute({
          cardId: this.id
        });
      },
      icon: AiBwIcon,
      tags: ['playground-sample-data']
    }, {
      label: `Generate ${GENERATED_EXAMPLE_COUNT} examples with AI`,
      action: async () => {
        await new GenerateExamplesForFieldSpecCommand(params.commandContext).execute({
          count: GENERATED_EXAMPLE_COUNT,
          codeRef: codeRefWithAbsoluteURL(this.ref, cardIdToURL(this.id)),
          realm: this[realmURL]?.href,
          exampleCard: this
        });
      },
      icon: AiBwIcon,
      tags: ['playground-sample-data']
    }]);
    return menuItems;
  }
  static isolated = Isolated;
  static embedded = class Embedded extends Component {
    get icon() {
      return this.args.model.constructor?.icon;
    }
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <article class='embedded-spec'>
        <div class='header-icon-container'>
          <this.icon width='30' height='30' role='presentation' />
        </div>
        <div class='header-info-container'>
          <h3 class='title'><@fields.cardTitle /></h3>
          <p class='description'><@fields.cardDescription /></p>
        </div>
        {{#if @model.specType}}
          <SpecTag @specType={{@model.specType}} />
        {{/if}}
      </article>
      <style scoped>
        .embedded-spec {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs);
        }
        .header-icon-container {
          flex-shrink: 0;
          height: var(--boxel-icon-xl);
          width: var(--boxel-icon-xl);
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--boxel-100);
          border: 1px solid var(--boxel-border-color);
          border-radius: var(--boxel-border-radius-lg);
          background-color: var(--boxel-light);
        }
        .header-info-container {
          flex: 1;
        }
        .title {
          margin: 0;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .description {
          margin: 0;
          color: var(--boxel-500);
          font: var(--boxel-font-size-xs);
          letter-spacing: var(--boxel-lsp-xs);
        }
      </style>
      */
      {
        "id": "p+CCyBs9",
        "block": "[[[10,\"article\"],[14,0,\"embedded-spec\"],[14,\"data-scopedcss-1f2e0dba4a-9e458290ef\",\"\"],[12],[1,\"\\n  \"],[10,0],[14,0,\"header-icon-container\"],[14,\"data-scopedcss-1f2e0dba4a-9e458290ef\",\"\"],[12],[1,\"\\n    \"],[8,[30,0,[\"icon\"]],[[24,\"width\",\"30\"],[24,\"height\",\"30\"],[24,\"role\",\"presentation\"],[24,\"data-scopedcss-1f2e0dba4a-9e458290ef\",\"\"]],null,null],[1,\"\\n  \"],[13],[1,\"\\n  \"],[10,0],[14,0,\"header-info-container\"],[14,\"data-scopedcss-1f2e0dba4a-9e458290ef\",\"\"],[12],[1,\"\\n    \"],[10,\"h3\"],[14,0,\"title\"],[14,\"data-scopedcss-1f2e0dba4a-9e458290ef\",\"\"],[12],[8,[30,1,[\"cardTitle\"]],[[24,\"data-scopedcss-1f2e0dba4a-9e458290ef\",\"\"]],null,null],[13],[1,\"\\n    \"],[10,2],[14,0,\"description\"],[14,\"data-scopedcss-1f2e0dba4a-9e458290ef\",\"\"],[12],[8,[30,1,[\"cardDescription\"]],[[24,\"data-scopedcss-1f2e0dba4a-9e458290ef\",\"\"]],null,null],[13],[1,\"\\n  \"],[13],[1,\"\\n\"],[41,[30,2,[\"specType\"]],[[[1,\"    \"],[8,[32,0],[[24,\"data-scopedcss-1f2e0dba4a-9e458290ef\",\"\"]],[[\"@specType\"],[[30,2,[\"specType\"]]]],null],[1,\"\\n\"]],[]],null],[13],[1,\"\\n\"]],[\"@fields\",\"@model\"],[\"if\"]]",
        "moduleName": "packages/runtime-common/spec.gts",
        "scope": () => [SpecTag],
        "isStrictMode": true
      }), this);
    }
  };
  static fitted = Fitted;
  static edit = Edit;
}
export class SpecTag extends GlimmerComponent {
  get icon() {
    return getIcon(this.args.specType);
  }
  static {
    setComponentTemplate(createTemplateFactory(
    /*
      {{#if this.icon}}
      <Pill @variant='muted' class='spec-tag-pill' ...attributes>
        <:iconLeft>
          <this.icon width='18px' height='18px' />
        </:iconLeft>
        <:default>
          {{@specType}}
        </:default>
      </Pill>
    
    {{/if}}
    <style scoped>
      .spec-tag-pill {
        --pill-font: 500 var(--boxel-font-xs);
        --pill-background-color: var(--boxel-200);
        --pill-icon-size: 18px;
        word-break: initial;
        text-transform: uppercase;
      }
    </style>
    */
    {
      "id": "ifvv1Tbq",
      "block": "[[[41,[30,0,[\"icon\"]],[[[1,\"  \"],[8,[32,0],[[24,0,\"spec-tag-pill\"],[17,1],[24,\"data-scopedcss-1f2e0dba4a-6759789cd1\",\"\"]],[[\"@variant\"],[\"muted\"]],[[\"iconLeft\",\"default\"],[[[[1,\"\\n      \"],[8,[30,0,[\"icon\"]],[[24,\"width\",\"18px\"],[24,\"height\",\"18px\"],[24,\"data-scopedcss-1f2e0dba4a-6759789cd1\",\"\"]],null,null],[1,\"\\n    \"]],[]],[[[1,\"\\n      \"],[1,[30,2]],[1,\"\\n    \"]],[]]]]],[1,\"\\n\\n\"]],[]],null]],[\"&attrs\",\"@specType\"],[\"if\"]]",
      "moduleName": "packages/runtime-common/spec.gts",
      "scope": () => [Pill],
      "isStrictMode": true
    }), this);
  }
}
function getIcon(specType) {
  switch (specType) {
    case 'card':
      return StackIcon;
    case 'app':
      return AppsIcon;
    case 'field':
      return LayoutList;
    case 'component':
      return LayoutList;
    default:
      return;
  }
}
function myLoader() {
  // we know this code is always loaded by an instance of our Loader, which sets
  // import.meta.loader.
  // When type-checking realm-server, tsc sees this file and thinks
  // it will be transpiled to CommonJS and so it complains about this line. But
  // this file is always loaded through our loader and always has access to import.meta.
  // @ts-ignore
  return import.meta.loader;
}