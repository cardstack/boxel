import { modifier } from 'ember-modifier'; // Replacing class-based modifiers with function modifiers
import SkillIcon from '@cardstack/boxel-icons/book-open';
import ActivityIcon from '@cardstack/boxel-icons/activity';
import EditIcon from '@cardstack/boxel-icons/edit';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import { gt } from '@cardstack/boxel-ui/helpers';
import { SkillPlus, TocItemField, slugifyHeading, DocLayout, TocSection, EmptyStateContainer, AppendixSection, parseMarkdownHeaders } from './skill-plus';
import { SkillReference } from './skill-reference';
import { Component, field, contains, containsMany } from './card-api';
import StringField from './string';
import MarkdownField from './markdown';
import "./skill-set.gts.CiAgLnNraWxsc2V0LWhlYWRlci1zdGF0c1tkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIHsKICAgIGRpc3BsYXk6IGZsZXg7CiAgICBnYXA6IHZhcigtLXNwLTQpOwogICAgbWFyZ2luLWJsb2NrOiB2YXIoLS1zcC0zKTsKICAgIHBhZGRpbmctdG9wOiB2YXIoLS1zcC0zKTsKICAgIGJvcmRlci10b3A6IDFweCBzb2xpZCB2YXIoLS1kYi1ib3JkZXIpOwogIH0KICAuc2tpbGxzZXQtaGVhZGVyLXN0YXQtaXRlbVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIHsKICAgIGRpc3BsYXk6IGlubGluZS1mbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGdhcDogY2FsYygxLjUgKiB2YXIoLS1zcC0xKSk7CiAgICBmb250LXNpemU6IHZhcigtLWJveGVsLWZvbnQtc2l6ZS14cyk7CiAgICBmb250LXdlaWdodDogNjAwOwogICAgY29sb3I6IHZhcigtLWRiLW11dGVkLWZvcmVncm91bmQpOwogIH0KICAuc2tpbGxzZXQtaGVhZGVyLXN0YXQtaWNvbltkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIHsKICAgIHdpZHRoOiAxcmVtOwogICAgaGVpZ2h0OiAxcmVtOwogIH0KCiAgLnNraWxsc2V0LWVtcHR5LWFjdGlvbnNbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS0yNTZmZWYyNGYzXSB7CiAgICBsaXN0LXN0eWxlOiBub25lOwogICAgcGFkZGluZzogMDsKICAgIG1hcmdpbi1ibG9jazogdmFyKC0tc3AtNik7CiAgICBtYXJnaW4taW5saW5lOiAwOwogICAgdGV4dC1hbGlnbjogc3RhcnQ7CiAgICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7CiAgICBmb250LXNpemU6IHZhcigtLWJveGVsLWZvbnQtc2l6ZS1zbSk7CiAgfQogIC5za2lsbHNldC1lbXB0eS1hY3Rpb25zW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtMjU2ZmVmMjRmM10gcCB7CiAgICBmb250LXNpemU6IGluaGVyaXQ7CiAgfQogIC5za2lsbHNldC1lbXB0eS1hY3Rpb25zW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtMjU2ZmVmMjRmM10gbGkgewogICAgZGlzcGxheTogZmxleDsKICAgIGFsaWduLWl0ZW1zOiBmbGV4LXN0YXJ0OwogICAgZ2FwOiB2YXIoLS1zcC0zKTsKICB9CiAgLnNraWxsc2V0LWVtcHR5LWFjdGlvbnNbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS0yNTZmZWYyNGYzXSBsaSArIGxpIHsKICAgIG1hcmdpbi10b3A6IHZhcigtLXNwLTYpOwogIH0KICAuc2tpbGxzZXQtZW1wdHktYWN0aW9uc1tkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIGxpIHN2ZyB7CiAgICB3aWR0aDogMS41cmVtOwogICAgaGVpZ2h0OiAxLjVyZW07CiAgICBmbGV4LXNocmluazogMDsKICAgIG1hcmdpbi10b3A6IGNhbGMoMC41ICogdmFyKC0tc3AtMSkpOwogIH0KICAuc2tpbGxzZXQtZW1wdHktYWN0aW9uc1tkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIHN0cm9uZyB7CiAgICBjb2xvcjogdmFyKC0tZGItZm9yZWdyb3VuZCk7CiAgICBmb250LXdlaWdodDogNjAwOwogIH0KCiAgLyogQ2xpY2thYmxlIHNraWxsIGRpdmlkZXIgc3R5bGluZyAqLwogIC5pbnN0cnVjdGlvbnMtYXJ0aWNsZVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIC5za2lsbC1kaXZpZGVyLWNsaWNrYWJsZSB7CiAgICBjdXJzb3I6IHBvaW50ZXI7CiAgfQogIC5pbnN0cnVjdGlvbnMtYXJ0aWNsZVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIC5za2lsbC1kaXZpZGVyLWNsaWNrYWJsZTpob3ZlciB7CiAgICB0cmFuc2Zvcm06IHRyYW5zbGF0ZVkoLTJweCk7CiAgICBib3gtc2hhZG93OiAwIDRweCAxNnB4IHJnYmEoMCwgMCwgMCwgMC4xMik7CiAgfQogIC5pbnN0cnVjdGlvbnMtYXJ0aWNsZVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIC5za2lsbC1kaXZpZGVyIHsKICAgIG1hcmdpbjogNHJlbSAwIDIuNXJlbSAwOwogICAgcGFkZGluZzogMnJlbTsKICAgIGJhY2tncm91bmQ6IHZhcigtLXNlY29uZGFyeSk7CiAgICBjb2xvcjogdmFyKC0tc2Vjb25kYXJ5LWZvcmVncm91bmQpOwogICAgYm9yZGVyOiAycHggc29saWQgdmFyKC0tc2Vjb25kYXJ5KTsKICAgIGJvcmRlci1yYWRpdXM6IHZhcigtLWJveGVsLWJvcmRlci1yYWRpdXMteGwsIDE2cHgpOwogICAgc2Nyb2xsLW1hcmdpbi10b3A6IDJyZW07CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGZsZXgtc3RhcnQ7CiAgICBnYXA6IDEuNXJlbTsKICAgIGJveC1zaGFkb3c6IDAgMnB4IDhweCByZ2JhKDAsIDAsIDAsIDAuMDgpOwogICAgdHJhbnNpdGlvbjogYWxsIDAuM3MgZWFzZTsKICB9CiAgLmluc3RydWN0aW9ucy1hcnRpY2xlW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtMjU2ZmVmMjRmM10gLmRpdmlkZXItbnVtYmVyIHsKICAgIGZsZXgtc2hyaW5rOiAwOwogICAgd2lkdGg6IDNyZW07CiAgICBoZWlnaHQ6IDNyZW07CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGp1c3RpZnktY29udGVudDogY2VudGVyOwogICAgZm9udC1zaXplOiAxLjVyZW07CiAgICBmb250LXdlaWdodDogODAwOwogICAgYmFja2dyb3VuZDogdmFyKC0tYmFja2dyb3VuZCk7CiAgICBjb2xvcjogdmFyKC0tZm9yZWdyb3VuZCk7CiAgICBib3JkZXI6IDJweCBzb2xpZCB2YXIoLS1ib3JkZXIpOwogICAgYm9yZGVyLXJhZGl1czogdmFyKC0tYm94ZWwtYm9yZGVyLXJhZGl1cy1sZywgMTJweCk7CiAgICBib3gtc2hhZG93OiAwIDFweCAzcHggcmdiYSgwLCAwLCAwLCAwLjEpOwogIH0KICAuaW5zdHJ1Y3Rpb25zLWFydGljbGVbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS0yNTZmZWYyNGYzXSAuZGl2aWRlci1jb250ZW50IHsKICAgIGZsZXg6IDE7CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2VlbjsKICAgIGdhcDogMC41cmVtOwogICAgbWluLXdpZHRoOiAwOwogIH0KICAuaW5zdHJ1Y3Rpb25zLWFydGljbGVbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS0yNTZmZWYyNGYzXSAuZGl2aWRlci10b3BpYyB7CiAgICBmb250LXNpemU6IDEuNzVyZW07CiAgICBmb250LXdlaWdodDogODAwOwogICAgY29sb3I6IHZhcigtLXNlY29uZGFyeS1mb3JlZ3JvdW5kKTsKICAgIGxldHRlci1zcGFjaW5nOiAtMC4wM2VtOwogICAgbGluZS1oZWlnaHQ6IDEuMTsKICB9CiAgLmluc3RydWN0aW9ucy1hcnRpY2xlW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtMjU2ZmVmMjRmM10gLmRpdmlkZXItbGluayB7CiAgICBmb250LXNpemU6IDAuNjg3NXJlbTsKICAgIGNvbG9yOiB2YXIoLS1zZWNvbmRhcnktZm9yZWdyb3VuZCk7CiAgICBvcGFjaXR5OiAwLjc7CiAgICB0ZXh0LWRlY29yYXRpb246IG5vbmU7CiAgICBmb250LWZhbWlseTogdmFyKC0tZm9udC1tb25vKTsKICAgIHRyYW5zaXRpb246IG9wYWNpdHkgMC4ycyBlYXNlOwogICAgd29yZC1icmVhazogYnJlYWstYWxsOwogICAgbGluZS1oZWlnaHQ6IDEuNDsKICB9CiAgLmluc3RydWN0aW9ucy1hcnRpY2xlW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtMjU2ZmVmMjRmM10gLmRpdmlkZXItbGluazpob3ZlciB7CiAgICBvcGFjaXR5OiAxOwogIH0KICAuaW5zdHJ1Y3Rpb25zLWFydGljbGVbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS0yNTZmZWYyNGYzXSAuZGl2aWRlci1jb250ZXh0IHsKICAgIGZvbnQtc2l6ZTogMC42ODc1cmVtOwogICAgY29sb3I6IHZhcigtLXNlY29uZGFyeS1mb3JlZ3JvdW5kKTsKICAgIG9wYWNpdHk6IDAuNzU7CiAgICBmb250LXN0eWxlOiBpdGFsaWM7CiAgICBtYXJnaW4tdG9wOiAwLjI1cmVtOwogICAgbGluZS1oZWlnaHQ6IDEuNTsKICAgIHBhZGRpbmctbGVmdDogMDsKICB9CiAgLyogwrLCsuKBuCBEaXZpZGVyIGluY2x1c2lvbiBtb2RlIGJhZGdlIC0gcGlsbCBzdHlsZSAqLwogIC5pbnN0cnVjdGlvbnMtYXJ0aWNsZVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIC5kaXZpZGVyLW1vZGUgewogICAgZGlzcGxheTogaW5saW5lLWJsb2NrOwogICAgZm9udC1zaXplOiAwLjYyNXJlbTsKICAgIGZvbnQtd2VpZ2h0OiA3MDA7CiAgICB0ZXh0LXRyYW5zZm9ybTogdXBwZXJjYXNlOwogICAgbGV0dGVyLXNwYWNpbmc6IDAuMDVlbTsKICAgIHBhZGRpbmc6IDAuMzc1cmVtIDAuNzVyZW07CiAgICBib3JkZXItcmFkaXVzOiA5OTlweDsKICAgIG1hcmdpbi10b3A6IDAuNXJlbTsKICAgIGJveC1zaGFkb3c6IDAgMXB4IDNweCByZ2JhKDAsIDAsIDAsIDAuMSk7CiAgfQogIC5pbnN0cnVjdGlvbnMtYXJ0aWNsZVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIC5kaXZpZGVyLW1vZGUtZnVsbCB7CiAgICAvKiDCssKy4oG5IEZ1bGwgbW9kZSBzdHlsaW5nIC0gcGlsbCAqLwogICAgYmFja2dyb3VuZDogdmFyKC0tcHJpbWFyeSk7CiAgICBjb2xvcjogdmFyKC0tcHJpbWFyeS1mb3JlZ3JvdW5kKTsKICB9CiAgLmluc3RydWN0aW9ucy1hcnRpY2xlW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtMjU2ZmVmMjRmM10gLmRpdmlkZXItbW9kZS1lc3NlbnRpYWwgewogICAgLyogwrLCs%2BKBsCBFc3NlbnRpYWwgbW9kZSBzdHlsaW5nIC0gcGlsbCAqLwogICAgYmFja2dyb3VuZDogdmFyKC0tYWNjZW50KTsKICAgIGNvbG9yOiB2YXIoLS1hY2NlbnQtZm9yZWdyb3VuZCk7CiAgfQogIC5pbnN0cnVjdGlvbnMtYXJ0aWNsZVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIC5kaXZpZGVyLW1vZGUtbGluay1vbmx5IHsKICAgIC8qIMKywrPCuSBMaW5rIG9ubHkgbW9kZSBzdHlsaW5nIC0gcGlsbCAqLwogICAgYmFja2dyb3VuZDogdmFyKC0tbXV0ZWQpOyAvKiDCsuKBtMKzIEJldHRlciBjb250cmFzdCAqLwogICAgY29sb3I6IHZhcigtLW11dGVkLWZvcmVncm91bmQpOwogICAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTsKICB9CgogIC5za2lsbHMtY2FyZHNbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS0yNTZmZWYyNGYzXSB7CiAgICBkaXNwbGF5OiBncmlkOwogICAgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiByZXBlYXQoYXV0by1maWxsLCBtaW5tYXgoMjgwcHgsIDFmcikpOwogICAgZ2FwOiB2YXIoLS1zcC00KTsKICB9CgogIEBtZWRpYSAobWF4LXdpZHRoOiA2NDBweCkgewogICAgLnNraWxscy1jYXJkc1tkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTI1NmZlZjI0ZjNdIHsKICAgICAgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiAxZnI7CiAgICB9CiAgfQo%3D.glimmer-scoped.css";
import { setComponentTemplate } from "@ember/component";
import { createTemplateFactory } from "@ember/template-factory";
import "./skill-set.gts.CiAgLyogwrnigbnigbUgUHJvZmVzc2lvbmFsIGVtYmVkZGVkIGNhcmQgc3R5bGluZyAqLwogIC5za2lsbC1zZXQtZW1iZWRkZWRbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS02MDVkOTc3ZjkxXSB7CiAgICBwYWRkaW5nOiAxLjI1cmVtOwogICAgYmFja2dyb3VuZDogdmFyKC0tY2FyZCk7CiAgICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpOwogICAgYm9yZGVyLXJhZGl1czogdmFyKC0tYm94ZWwtYm9yZGVyLXJhZGl1cy1sZyk7CiAgICBib3gtc2hhZG93OiB2YXIoLS1zaGFkb3ctc20pOwogIH0KCiAgLmVtYmVkZGVkLWhlYWRlcltkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTYwNWQ5NzdmOTFdIHsKICAgIG1hcmdpbi1ib3R0b206IDFyZW07CiAgICBwYWRkaW5nLWJvdHRvbTogMC43NXJlbTsKICAgIGJvcmRlci1ib3R0b206IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpOwogIH0KCiAgLnNraWxsLXR5cGUtYmFkZ2VbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS02MDVkOTc3ZjkxXSB7CiAgICBkaXNwbGF5OiBpbmxpbmUtZmxleDsKICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICBnYXA6IDAuMzc1cmVtOwogICAgZm9udC1zaXplOiAwLjYyNXJlbTsKICAgIGZvbnQtd2VpZ2h0OiA3MDA7CiAgICB0ZXh0LXRyYW5zZm9ybTogdXBwZXJjYXNlOwogICAgbGV0dGVyLXNwYWNpbmc6IDAuMDVlbTsKICAgIGNvbG9yOiB2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKTsKICAgIG1hcmdpbi1ib3R0b206IDAuNXJlbTsKICB9CgogIC5iYWRnZS1pY29uW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtNjA1ZDk3N2Y5MV0gewogICAgd2lkdGg6IDAuODc1cmVtOwogICAgaGVpZ2h0OiAwLjg3NXJlbTsKICB9CgogIC5lbWJlZGRlZC10aXRsZVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTYwNWQ5NzdmOTFdIHsKICAgIGZvbnQtc2l6ZTogMS4xMjVyZW07CiAgICBmb250LXdlaWdodDogNzAwOwogICAgbWFyZ2luOiAwOwogICAgY29sb3I6IHZhcigtLWZvcmVncm91bmQpOwogICAgbGluZS1oZWlnaHQ6IDEuMzsKICB9CgogIC5lbWJlZGRlZC1kZXNjcmlwdGlvbltkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTYwNWQ5NzdmOTFdIHsKICAgIGZvbnQtc2l6ZTogMC44NzVyZW07CiAgICBjb2xvcjogdmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCk7CiAgICBsaW5lLWhlaWdodDogMS41OwogICAgbWFyZ2luOiAwIDAgMXJlbSAwOwogIH0KCiAgLnNraWxscy1zdW1tYXJ5W2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtNjA1ZDk3N2Y5MV0gewogICAgbWFyZ2luLXRvcDogMXJlbTsKICB9CgogIC5zdW1tYXJ5LWxhYmVsW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtNjA1ZDk3N2Y5MV0gewogICAgZm9udC1zaXplOiAwLjY4NzVyZW07CiAgICBmb250LXdlaWdodDogNzAwOwogICAgdGV4dC10cmFuc2Zvcm06IHVwcGVyY2FzZTsKICAgIGxldHRlci1zcGFjaW5nOiAwLjA1ZW07CiAgICBjb2xvcjogdmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCk7CiAgICBtYXJnaW4tYm90dG9tOiAwLjVyZW07CiAgfQoKICAuc2tpbGxzLWNvdW50W2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtNjA1ZDk3N2Y5MV0gewogICAgZm9udC1zaXplOiAwLjc1cmVtOwogICAgZm9udC13ZWlnaHQ6IDYwMDsKICAgIGNvbG9yOiB2YXIoLS1wcmltYXJ5KTsKICAgIG1hcmdpbi1ib3R0b206IDAuNzVyZW07CiAgfQoKICAuc2tpbGxzLWxpc3RbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS02MDVkOTc3ZjkxXSB7CiAgICBkaXNwbGF5OiBmbGV4OwogICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsKICAgIGdhcDogMC4zNzVyZW07CiAgfQoKICAuc2tpbGwtaXRlbVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTYwNWQ5NzdmOTFdIHsKICAgIGRpc3BsYXk6IGZsZXg7CiAgICBhbGlnbi1pdGVtczogY2VudGVyOwogICAgZ2FwOiAwLjVyZW07CiAgICBmb250LXNpemU6IDAuNzVyZW07CiAgICBsaW5lLWhlaWdodDogMS40OwogIH0KCiAgLnNraWxsLWJ1bGxldFtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTYwNWQ5NzdmOTFdIHsKICAgIGNvbG9yOiB2YXIoLS1wcmltYXJ5KTsKICAgIGZvbnQtd2VpZ2h0OiA3MDA7CiAgICBmbGV4LXNocmluazogMDsKICB9CgogIC5za2lsbC1uYW1lW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtNjA1ZDk3N2Y5MV0gewogICAgZmxleDogMTsKICAgIGNvbG9yOiB2YXIoLS1mb3JlZ3JvdW5kKTsKICAgIGZvbnQtd2VpZ2h0OiA1MDA7CiAgfQoKICAuc2tpbGwtbW9kZVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTYwNWQ5NzdmOTFdIHsKICAgIGZvbnQtc2l6ZTogMC42MjVyZW07CiAgICBmb250LXdlaWdodDogNjAwOwogICAgdGV4dC10cmFuc2Zvcm06IHVwcGVyY2FzZTsKICAgIGxldHRlci1zcGFjaW5nOiAwLjA1ZW07CiAgICBwYWRkaW5nOiAwLjEyNXJlbSAwLjM3NXJlbTsKICAgIGJhY2tncm91bmQ6IHZhcigtLW11dGVkKTsKICAgIGNvbG9yOiB2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKTsKICAgIGJvcmRlci1yYWRpdXM6IHZhcigtLWJveGVsLWJvcmRlci1yYWRpdXMtc20pOwogICAgZmxleC1zaHJpbms6IDA7CiAgfQoKICAuZW1wdHktc2tpbGxzW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtNjA1ZDk3N2Y5MV0gewogICAgbWFyZ2luLXRvcDogMXJlbTsKICAgIHBhZGRpbmc6IDFyZW07CiAgICBiYWNrZ3JvdW5kOiB2YXIoLS1tdXRlZCk7CiAgICBib3JkZXItcmFkaXVzOiB2YXIoLS1ib3hlbC1ib3JkZXItcmFkaXVzKTsKICAgIHRleHQtYWxpZ246IGNlbnRlcjsKICB9CgogIC5lbXB0eS1za2lsbHMgcFtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLTYwNWQ5NzdmOTFdIHsKICAgIG1hcmdpbjogMDsKICAgIGZvbnQtc2l6ZTogMC44MTI1cmVtOwogICAgY29sb3I6IHZhcigtLW11dGVkLWZvcmVncm91bmQpOwogICAgZm9udC1zdHlsZTogaXRhbGljOwogIH0K.glimmer-scoped.css";
import "./skill-set.gts.CiAgLyogRml0dGVkIGNvbnRhaW5lciB3aXRoIHNpemUtYmFzZWQgZGlzcGxheSAqLwogIC5maXR0ZWQtY29udGFpbmVyW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtYjkzMDU3MjMyYl0gewogICAgY29udGFpbmVyLXR5cGU6IHNpemU7CiAgICB3aWR0aDogMTAwJTsKICAgIGhlaWdodDogMTAwJTsKICAgIGJhY2tncm91bmQ6IHZhcigtLWNhcmQpOwogICAgb3ZlcmZsb3c6IGhpZGRlbjsKICB9CgogIC8qIMKy4oGwwrIgSGlkZSBhbGwgZm9ybWF0cyBieSBkZWZhdWx0ICovCiAgLmJhZGdlLWZvcm1hdFtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLWI5MzA1NzIzMmJdLAogIC5zdHJpcC1mb3JtYXRbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSwKICAudGlsZS1mb3JtYXRbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSwKICAuY2FyZC1mb3JtYXRbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICBkaXNwbGF5OiBub25lOwogICAgd2lkdGg6IDEwMCU7CiAgICBoZWlnaHQ6IDEwMCU7CiAgICBib3gtc2l6aW5nOiBib3JkZXItYm94OwogIH0KCiAgLyogwrLigbDCsyBCYWRnZSBmb3JtYXQgLSBjb21wYWN0IGljb24gKyBjb3VudCAqLwogIEBjb250YWluZXIgKG1heC13aWR0aDogMTUwcHgpIGFuZCAobWF4LWhlaWdodDogMTY5cHgpIHsKICAgIC5iYWRnZS1mb3JtYXRbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICAgIGRpc3BsYXk6IGZsZXg7CiAgICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47CiAgICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICAgIGp1c3RpZnktY29udGVudDogY2VudGVyOwogICAgICBnYXA6IDAuMjVyZW07CiAgICAgIHBhZGRpbmc6IDAuMzc1cmVtOwogICAgfQogIH0KCiAgLmJhZGdlLXRpdGxlW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtYjkzMDU3MjMyYl0gewogICAgZm9udC1zaXplOiBjbGFtcCgwLjYyNXJlbSwgNCUsIDAuNzVyZW0pOwogICAgZm9udC13ZWlnaHQ6IDcwMDsKICAgIGNvbG9yOiB2YXIoLS1mb3JlZ3JvdW5kKTsKICAgIHRleHQtYWxpZ246IGNlbnRlcjsKICAgIG92ZXJmbG93OiBoaWRkZW47CiAgICB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpczsKICAgIGRpc3BsYXk6IC13ZWJraXQtYm94OwogICAgLXdlYmtpdC1saW5lLWNsYW1wOiAzOwogICAgLXdlYmtpdC1ib3gtb3JpZW50OiB2ZXJ0aWNhbDsKICAgIGxpbmUtaGVpZ2h0OiAxLjI7CiAgfQoKICAvKiBTdHJpcCBmb3JtYXQgLSBob3Jpem9udGFsIGJhciAqLwogIEBjb250YWluZXIgKG1pbi13aWR0aDogMTUxcHgpIGFuZCAobWF4LWhlaWdodDogMTY5cHgpIHsKICAgIC5zdHJpcC1mb3JtYXRbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICAgIGRpc3BsYXk6IGZsZXg7CiAgICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICAgIGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2VlbjsKICAgICAgcGFkZGluZzogMC41cmVtIDAuNzVyZW07CiAgICAgIGdhcDogMC41cmVtOwogICAgfQogIH0KCiAgLnN0cmlwLWxlZnRbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGdhcDogMC41cmVtOwogICAgbWluLXdpZHRoOiAwOwogICAgZmxleDogMTsKICB9CgogIC5zdHJpcC1pY29uW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtYjkzMDU3MjMyYl0gewogICAgd2lkdGg6IDEuMTI1cmVtOwogICAgaGVpZ2h0OiAxLjEyNXJlbTsKICAgIGNvbG9yOiB2YXIoLS1wcmltYXJ5KTsKICAgIGZsZXgtc2hyaW5rOiAwOwogIH0KCiAgLnN0cmlwLXRpdGxlW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtYjkzMDU3MjMyYl0gewogICAgZm9udC1zaXplOiAwLjg3NXJlbTsKICAgIGZvbnQtd2VpZ2h0OiA2MDA7CiAgICBjb2xvcjogdmFyKC0tZm9yZWdyb3VuZCk7CiAgICB3aGl0ZS1zcGFjZTogbm93cmFwOwogICAgb3ZlcmZsb3c6IGhpZGRlbjsKICAgIHRleHQtb3ZlcmZsb3c6IGVsbGlwc2lzOwogIH0KCiAgLnN0cmlwLWNvdW50W2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtYjkzMDU3MjMyYl0gewogICAgZm9udC1zaXplOiAwLjY4NzVyZW07CiAgICBmb250LXdlaWdodDogNjAwOwogICAgY29sb3I6IHZhcigtLW11dGVkLWZvcmVncm91bmQpOwogICAgZmxleC1zaHJpbms6IDA7CiAgfQoKICAvKiBUaWxlIGZvcm1hdCAtIHZlcnRpY2FsIGNhcmQgKi8KICBAY29udGFpbmVyIChtYXgtd2lkdGg6IDM5OXB4KSBhbmQgKG1pbi1oZWlnaHQ6IDE3MHB4KSB7CiAgICAudGlsZS1mb3JtYXRbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICAgIGRpc3BsYXk6IGZsZXg7CiAgICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47CiAgICAgIHBhZGRpbmc6IGNsYW1wKDAuNXJlbSwgMyUsIDAuODc1cmVtKTsKICAgICAgZ2FwOiAwLjVyZW07CiAgICB9CiAgfQoKICAudGlsZS1oZWFkZXJbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGdhcDogMC4zNzVyZW07CiAgfQoKICAudGlsZS1pY29uW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtYjkzMDU3MjMyYl0gewogICAgd2lkdGg6IDFyZW07CiAgICBoZWlnaHQ6IDFyZW07CiAgICBjb2xvcjogdmFyKC0tcHJpbWFyeSk7CiAgfQoKICAudGlsZS1iYWRnZVtkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLWI5MzA1NzIzMmJdIHsKICAgIGZvbnQtc2l6ZTogMC41NjI1cmVtOwogICAgZm9udC13ZWlnaHQ6IDcwMDsKICAgIHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7CiAgICBsZXR0ZXItc3BhY2luZzogMC4wNWVtOwogICAgY29sb3I6IHZhcigtLW11dGVkLWZvcmVncm91bmQpOwogIH0KCiAgLnRpbGUtdGl0bGVbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICBmb250LXNpemU6IGNsYW1wKDAuODc1cmVtLCA0JSwgMXJlbSk7CiAgICBmb250LXdlaWdodDogNzAwOwogICAgbWFyZ2luOiAwOwogICAgY29sb3I6IHZhcigtLWZvcmVncm91bmQpOwogICAgbGluZS1oZWlnaHQ6IDEuMjsKICAgIG92ZXJmbG93OiBoaWRkZW47CiAgICB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpczsKICAgIGRpc3BsYXk6IC13ZWJraXQtYm94OwogICAgLXdlYmtpdC1saW5lLWNsYW1wOiAyOwogICAgLXdlYmtpdC1ib3gtb3JpZW50OiB2ZXJ0aWNhbDsKICB9CgogIC50aWxlLXN0YXRzW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtYjkzMDU3MjMyYl0gewogICAgZGlzcGxheTogZmxleDsKICAgIGdhcDogMC41cmVtOwogIH0KCiAgLnN0YXRbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICBmb250LXNpemU6IDAuNjg3NXJlbTsKICAgIGZvbnQtd2VpZ2h0OiA2MDA7CiAgICBjb2xvcjogdmFyKC0tcHJpbWFyeSk7CiAgfQoKICAudGlsZS1kZXNjcmlwdGlvbltkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLWI5MzA1NzIzMmJdIHsKICAgIGZvbnQtc2l6ZTogMC42ODc1cmVtOwogICAgY29sb3I6IHZhcigtLW11dGVkLWZvcmVncm91bmQpOwogICAgbGluZS1oZWlnaHQ6IDEuNDsKICAgIG1hcmdpbjogMDsKICAgIG92ZXJmbG93OiBoaWRkZW47CiAgICB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpczsKICAgIGRpc3BsYXk6IC13ZWJraXQtYm94OwogICAgLXdlYmtpdC1saW5lLWNsYW1wOiAzOwogICAgLXdlYmtpdC1ib3gtb3JpZW50OiB2ZXJ0aWNhbDsKICB9CgogIC8qIENhcmQgZm9ybWF0IC0gZnVsbCBsYXlvdXQgKi8KICBAY29udGFpbmVyIChtaW4td2lkdGg6IDQwMHB4KSBhbmQgKG1pbi1oZWlnaHQ6IDE3MHB4KSB7CiAgICAuY2FyZC1mb3JtYXRbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICAgIGRpc3BsYXk6IGZsZXg7CiAgICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47CiAgICAgIHBhZGRpbmc6IGNsYW1wKDAuNzVyZW0sIDMlLCAxcmVtKTsKICAgICAgZ2FwOiAwLjc1cmVtOwogICAgfQogIH0KCiAgLmNhcmQtaGVhZGVyW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtYjkzMDU3MjMyYl0gewogICAgZGlzcGxheTogZmxleDsKICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47CiAgICBnYXA6IDAuNXJlbTsKICB9CgogIC5jYXJkLW1ldGFbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICBkaXNwbGF5OiBmbGV4OwogICAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgIGdhcDogMC4zNzVyZW07CiAgfQoKICAuY2FyZC1pY29uW2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtYjkzMDU3MjMyYl0gewogICAgd2lkdGg6IDEuMTI1cmVtOwogICAgaGVpZ2h0OiAxLjEyNXJlbTsKICAgIGNvbG9yOiB2YXIoLS1wcmltYXJ5KTsKICB9CgogIC5jYXJkLXR5cGVbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICBmb250LXNpemU6IDAuNjI1cmVtOwogICAgZm9udC13ZWlnaHQ6IDcwMDsKICAgIHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7CiAgICBsZXR0ZXItc3BhY2luZzogMC4wNWVtOwogICAgY29sb3I6IHZhcigtLW11dGVkLWZvcmVncm91bmQpOwogIH0KCiAgLmNhcmQtdGl0bGVbZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICBmb250LXNpemU6IDEuMTI1cmVtOwogICAgZm9udC13ZWlnaHQ6IDcwMDsKICAgIG1hcmdpbjogMDsKICAgIGNvbG9yOiB2YXIoLS1mb3JlZ3JvdW5kKTsKICAgIGxpbmUtaGVpZ2h0OiAxLjM7CiAgICBvdmVyZmxvdzogaGlkZGVuOwogICAgdGV4dC1vdmVyZmxvdzogZWxsaXBzaXM7CiAgICBkaXNwbGF5OiAtd2Via2l0LWJveDsKICAgIC13ZWJraXQtbGluZS1jbGFtcDogMjsKICAgIC13ZWJraXQtYm94LW9yaWVudDogdmVydGljYWw7CiAgfQoKICAuY2FyZC1kZXNjcmlwdGlvbltkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLWI5MzA1NzIzMmJdIHsKICAgIGZvbnQtc2l6ZTogMC44MTI1cmVtOwogICAgY29sb3I6IHZhcigtLW11dGVkLWZvcmVncm91bmQpOwogICAgbGluZS1oZWlnaHQ6IDEuNTsKICAgIG1hcmdpbjogMDsKICAgIG92ZXJmbG93OiBoaWRkZW47CiAgICB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpczsKICAgIGRpc3BsYXk6IC13ZWJraXQtYm94OwogICAgLXdlYmtpdC1saW5lLWNsYW1wOiAyOwogICAgLXdlYmtpdC1ib3gtb3JpZW50OiB2ZXJ0aWNhbDsKICB9CgogIC5jYXJkLWZvb3RlcltkYXRhLXNjb3BlZGNzcy1hOTFiZGQ3NjRhLWI5MzA1NzIzMmJdIHsKICAgIG1hcmdpbi10b3A6IGF1dG87CiAgICBwYWRkaW5nLXRvcDogMC43NXJlbTsKICAgIGJvcmRlci10b3A6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpOwogIH0KCiAgLmZvb3Rlci1zdGF0W2RhdGEtc2NvcGVkY3NzLWE5MWJkZDc2NGEtYjkzMDU3MjMyYl0gewogICAgZGlzcGxheTogaW5saW5lLWZsZXg7CiAgICBhbGlnbi1pdGVtczogY2VudGVyOwogICAgZ2FwOiAwLjM3NXJlbTsKICAgIGZvbnQtc2l6ZTogMC43NXJlbTsKICAgIGZvbnQtd2VpZ2h0OiA2MDA7CiAgICBjb2xvcjogdmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCk7CiAgfQoKICAuZm9vdGVyLWljb25bZGF0YS1zY29wZWRjc3MtYTkxYmRkNzY0YS1iOTMwNTcyMzJiXSB7CiAgICB3aWR0aDogMC44NzVyZW07CiAgICBoZWlnaHQ6IDAuODc1cmVtOwogIH0K.glimmer-scoped.css";
function isFence(line) {
  if (!line) return false;
  const c = line[0];
  return (c === '`' || c === '~') && line.startsWith(c.repeat(3));
}
function getModeLabel(mode) {
  return mode === 'full' ? 'Full' : mode === 'essential' ? 'Essential' : 'Link Only';
}
// Normalize markdown header levels so the top-level header in any skill becomes H2.
// Skips fenced code blocks. Used both for building instructions and for counting
// how many headings a skill contributes to the combined document.
function normalizeHeaders(markdown) {
  if (!markdown) return markdown;
  const lines = markdown.split('\n');
  let insideFence = false;
  // Pass 1: find minimum header level outside fenced code
  let minLevel;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (isFence(trimmed)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    const m = trimmed.match(/^(#{1,6})\s+/);
    if (m) {
      const lvl = m[1].length;
      minLevel = minLevel === undefined ? lvl : Math.min(minLevel, lvl);
    }
  }
  if (minLevel === undefined) return markdown;
  const levelShift = 2 - minLevel; // make top level ## (H2)
  if (levelShift === 0) return markdown;
  // Pass 2: shift headers outside fences
  insideFence = false;
  const out = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (isFence(trimmed)) {
      insideFence = !insideFence;
      out.push(raw);
      continue;
    }
    if (insideFence) {
      out.push(raw);
      continue;
    }
    const m = raw.match(/^(\s*)(#{1,6})\s+(.*)$/);
    if (m) {
      const leading = m[1] ?? '';
      const rest = m[3] ?? '';
      const newLevel = Math.max(2, Math.min(6, m[2].length + levelShift));
      out.push(`${leading}${'#'.repeat(newLevel)} ${rest}`);
    } else {
      out.push(raw);
    }
  }
  return out.join('\n');
}
// Compute table of contents markdown for a Skill Set's related skills
// Updated to handle frontMatter, backMatter, and different indentation styles
function computeTableOfContents(relatedSkills = [], frontMatter, backMatter) {
  const tocLines = [];
  let sectionNumber = 0;
  // ²⁵⁵ Parse markdown heading (## or ###) into structured data
  // Handles headers with or without leading whitespace
  const parseHeading = line => {
    // ²⁵⁶ Match headers with optional leading whitespace (for indented content)
    const match = line.match(/^\s*(#{2,3})\s+(.+)$/);
    if (!match) return null;
    const level = match[1].length;
    let raw = match[2].trim();
    const idMatch = raw.match(/\{#([a-z0-9-]+)\}/);
    const explicitId = idMatch ? idMatch[1] : null;
    // Strip explicit ID, HTML tags, and link markdown
    raw = raw.replace(/\s*\{#[a-z0-9-]+\}\s*/g, '').replace(/^[\d.]+\s+/, '').replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
    const id = explicitId || slugifyHeading(raw);
    return {
      level,
      text: raw,
      id
    };
  };
  // Helper to extract headers from markdown content
  const extractHeadersFromMarkdown = (content, baseIndent = 1) => {
    if (!content) return;
    let inFence = false;
    for (const rawLine of content.split('\n')) {
      if (isFence(rawLine.trim())) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const heading = parseHeading(rawLine);
      if (!heading) continue;
      // Calculate indent based on header level relative to base
      const indent = '  '.repeat(heading.level - 2 + baseIndent);
      tocLines.push(`${indent}- [${heading.text}](#${heading.id})`);
    }
  };
  // Process frontMatter headers (if any)
  if (frontMatter) {
    extractHeadersFromMarkdown(frontMatter, 0);
  }
  // Process related skills
  for (let i = 0; i < relatedSkills.length; i++) {
    const skillRef = relatedSkills[i];
    if (!skillRef) continue;
    sectionNumber += 1;
    const topicName = skillRef.topicName || skillRef.skill?.cardTitle || 'Untitled';
    const dividerAnchorId = `skill-divider-${i}`;
    tocLines.push(`- [**${sectionNumber}** ${topicName}](#${dividerAnchorId})`);
    const mode = skillRef.inclusionMode || 'link-only';
    // ²⁶² Get skill content based on inclusion mode
    const skillContent = skillRef.skill?.instructions && mode === 'full' ? skillRef.skill.instructions : mode === 'essential' && skillRef.essentials ? skillRef.essentials : '';
    if (!skillContent) continue;
    // Extract headers with indent level 1 (nested under skill divider)
    let inFence = false;
    for (const rawLine of skillContent.split('\n')) {
      if (isFence(rawLine.trim())) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const heading = parseHeading(rawLine);
      if (!heading) continue;
      // ²⁶⁴ Indent nested headers: 2 spaces for H2, 4 spaces for H3
      const indent = '  '.repeat(heading.level - 1);
      tocLines.push(`${indent}- [${heading.text}](#${heading.id})`);
    }
  }
  // Process backMatter headers (if any)
  if (backMatter) {
    extractHeadersFromMarkdown(backMatter, 0);
  }
  const toc = tocLines.join('\n');
  return toc.length > 0 ? toc : undefined;
}
// Delegate click/keyboard activation for skill dividers to the container
const dividerActivation = modifier((element, [activate]) => {
  const findDivider = target => target?.closest('.skill-divider-clickable');
  const handleClick = event => {
    const divider = findDivider(event.target);
    const cardUrl = divider?.getAttribute('data-card-url');
    if (cardUrl) {
      activate(cardUrl, event);
    }
  };
  const handleKeydown = event => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const divider = findDivider(event.target);
    const cardUrl = divider?.getAttribute('data-card-url');
    if (cardUrl) {
      event.preventDefault(); // Prevent page scroll on Space
      activate(cardUrl, event);
    }
  };
  element.addEventListener('click', handleClick);
  element.addEventListener('keydown', handleKeydown);
  return () => {
    element.removeEventListener('click', handleClick);
    element.removeEventListener('keydown', handleKeydown);
  };
});
export class SkillSet extends SkillPlus {
  static displayName = 'Skill Set';
  static prefersWideFormat = true;
  static {
    dt7948.g(this.prototype, "cardTitle", [field], function () {
      return contains(StringField, {
        computeVia: function () {
          return this.cardInfo?.name || `Untitled Skill Set`;
        }
      });
    });
  }
  #cardTitle = (dt7948.i(this, "cardTitle"), void 0);
  static {
    dt7948.g(this.prototype, "relatedSkills", [field], function () {
      return containsMany(SkillReference);
    });
  }
  #relatedSkills = (dt7948.i(this, "relatedSkills"), void 0);
  static {
    dt7948.g(this.prototype, "frontMatter", [field], function () {
      return contains(MarkdownField, {
        // Editable front matter
        description: 'Front matter content - appears at the beginning of instructions'
      });
    });
  }
  #frontMatter = (dt7948.i(this, "frontMatter"), void 0);
  static {
    dt7948.g(this.prototype, "backMatter", [field], function () {
      return contains(MarkdownField, {
        // Editable back matter
        description: 'Back matter content - appears at the end of instructions'
      });
    });
  }
  #backMatter = (dt7948.i(this, "backMatter"), void 0);
  static {
    dt7948.g(this.prototype, "tableOfContents", [field], function () {
      return contains(MarkdownField, {
        // Computed TOC from skill sections and their headers
        computeVia: function () {
          return computeTableOfContents(this.relatedSkills);
        }
      });
    });
  }
  #tableOfContents = (dt7948.i(this, "tableOfContents"), void 0);
  static {
    dt7948.g(this.prototype, "frontMatterToc", [field], function () {
      return containsMany(TocItemField, {
        // Slice from this.toc so IDs match the anchors in instructionsWithIds exactly.
        computeVia: function () {
          const count = parseMarkdownHeaders(this.frontMatter).length;
          return this.toc.slice(0, count);
        }
      });
    });
  }
  #frontMatterToc = (dt7948.i(this, "frontMatterToc"), void 0);
  static {
    dt7948.g(this.prototype, "backMatterToc", [field], function () {
      return containsMany(TocItemField, {
        // Slice from this.toc so IDs match the anchors in instructionsWithIds exactly.
        computeVia: function () {
          const count = parseMarkdownHeaders(this.backMatter).length;
          return count > 0 ? this.toc.slice(-count) : [];
        }
      });
    });
  }
  #backMatterToc = (dt7948.i(this, "backMatterToc"), void 0);
  static {
    dt7948.g(this.prototype, "contentToc", [field], function () {
      return containsMany(TocItemField, {
        // Heading IDs come from this.toc (same dedup context as instructionsWithIds).
        // normalizeHeaders gives accurate per-skill heading counts in the combined doc.
        computeVia: function () {
          const allToc = this.toc;
          const frontCount = parseMarkdownHeaders(this.frontMatter).length;
          const backCount = parseMarkdownHeaders(this.backMatter).length;
          const contentHeadings = allToc.slice(frontCount, backCount > 0 ? allToc.length - backCount : undefined);
          const items = [];
          let headingIdx = 0;
          for (let i = 0; i < (this.relatedSkills?.length ?? 0); i++) {
            const skillRef = this.relatedSkills[i];
            if (!skillRef) continue;
            const topicName = skillRef.topicName || skillRef.skill?.cardTitle || 'Untitled';
            const sectionNumber = i + 1;
            items.push(Object.assign(new TocItemField(), {
              level: 2,
              text: topicName,
              badge: String(sectionNumber),
              id: `skill-divider-${i}`
            }));
            const mode = skillRef.inclusionMode || 'link-only';
            const rawContent = mode === 'full' && skillRef.skill?.instructions ? skillRef.skill.instructions : mode === 'essential' && skillRef.essentials ? skillRef.essentials : '';
            // Normalize before counting so the count matches the combined instructions
            const skillHeadingCount = parseMarkdownHeaders(normalizeHeaders(rawContent)).length;
            for (let j = 0; j < skillHeadingCount; j++) {
              const heading = contentHeadings[headingIdx++];
              if (heading) items.push(Object.assign(new TocItemField(), {
                level: heading.level + 1,
                text: heading.text,
                id: heading.id
              }));
            }
          }
          return items;
        }
      });
    });
  }
  #contentToc = (dt7948.i(this, "contentToc"), void 0);
  static {
    dt7948.g(this.prototype, "instructions", [field], function () {
      return contains(MarkdownField, {
        // Computed instructions with table-based skill dividers (NO TOC embedded)
        computeVia: function () {
          let result = '';
          // Add front matter
          if (this.frontMatter) {
            result += this.frontMatter + '\n\n';
          }
          // REMOVED: Do NOT add tableOfContents here - breaks circular dependency
          // TOC is extracted FROM instructions and displayed separately in template
          // Add related skills with numbered dividers
          if (this.relatedSkills && this.relatedSkills.length > 0) {
            for (let i = 0; i < this.relatedSkills.length; i++) {
              const skillRef = this.relatedSkills[i];
              if (!skillRef) continue;
              const sectionNumber = i + 1; // Number the dividers 1, 2, 3...
              const mode = skillRef.inclusionMode || 'link-only';
              const topicName = skillRef.topicName || 'Untitled';
              const dividerAnchorId = `skill-divider-${i}`;
              const skillURL = skillRef.skill?.id || ''; // ²³² Get skill URL
              // Premium numbered divider - NO <a href>, clickable via CSS cursor
              const dividerLines = [];
              // Add data attribute for click handler, no href wrapper
              if (skillURL) {
                dividerLines.push(`<div class="skill-divider skill-divider-clickable" id="${dividerAnchorId}" data-card-url="${skillURL}" role="button" tabindex="0" aria-label="Open ${topicName}">`, `  <div class="divider-number">${sectionNumber}</div>`, '  <div class="divider-content">', `    <div class="divider-topic">${topicName}</div>`);
              } else {
                dividerLines.push(`<div class="skill-divider" id="${dividerAnchorId}">`, `  <div class="divider-number">${sectionNumber}</div>`, '  <div class="divider-content">', `    <div class="divider-topic">${topicName}</div>`);
              }
              if (skillRef.contentSummary) {
                const indent = '    ';
                dividerLines.push(`${indent}<div class="divider-context">📖 Contains: ${skillRef.contentSummary}</div>`);
              }
              // Add inclusion mode badge to divider (pill-style)
              const indent = '    ';
              dividerLines.push(`${indent}<div class="divider-mode divider-mode-${mode}">${getModeLabel(mode)}</div>`);
              // Close divider tags (no closing </a>)
              dividerLines.push('  </div>', '</div>');
              result += '\n' + dividerLines.join('\n') + '\n\n'; // ²¹³ Blank line before HTML, two newlines after to ensure markdown parsing resumes
              // Add skill content with header normalization
              if (mode === 'full' && skillRef.skill?.instructions) {
                result += normalizeHeaders(skillRef.skill.instructions) + '\n\n';
              } else if (mode === 'essential' && skillRef.essentials) {
                result += normalizeHeaders(skillRef.essentials) + '\n\n';
              }
            }
          }
          // Add back matter
          if (this.backMatter) {
            result += this.backMatter;
          }
          // Return pure markdown - MarkdownField will render it
          return result || undefined;
        }
      });
    });
  }
  #instructions = (dt7948.i(this, "instructions"), void 0);
  static isolated = class Isolated extends Component {
    // Activate skill divider via mouse or keyboard using viewCard API
    activateDivider = (cardUrl, event) => {
      if (this.args.viewCard) {
        event.preventDefault();
        event.stopPropagation();
        this.args.viewCard(new URL(cardUrl), 'isolated');
      }
    };
    get isTocEmpty() {
      return !this.args.model?.contentToc?.length && !this.args.model?.frontMatterToc?.length && !this.args.model?.backMatterToc?.length && !this.hasAppendix;
    }
    get hasAppendix() {
      return this.args.model?.relatedSkills?.length || this.args.model?.commands?.length;
    }
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <DocLayout
        class='skill-set-documentation'
        @titleMeta='Skill Set Documentation'
        @title={{@model.cardTitle}}
        @description={{@model.cardDescription}}
        @hideToc={{this.isTocEmpty}}
      >
        <:navbar>
          {{#if @model.frontMatterToc.length}}
            <TocSection
              @sectionTitle='Intro'
              @navItems={{@model.frontMatterToc}}
            />
          {{/if}}
          {{#if @model.contentToc.length}}
            <TocSection
              @sectionTitle='Content'
              @navItems={{@model.contentToc}}
            />
          {{/if}}
          {{#if @model.backMatterToc.length}}
            <TocSection
              @sectionTitle='Summary'
              @navItems={{@model.backMatterToc}}
            />
          {{/if}}
          {{#if this.hasAppendix}}
            <TocSection @sectionTitle='Appendix'>
              <ul>
                {{#if @model.relatedSkills.length}}
                  <li><a href='#skills-footer'>Related Skills</a></li>
                {{/if}}
                {{#if @model.commands.length}}
                  <li><a href='#available-commands'>Available Commands</a></li>
                {{/if}}
              </ul>
            </TocSection>
          {{/if}}
        </:navbar>
        <:headerRow>
          <div class='skillset-header-stats'>
            <span class='skillset-header-stat-item'>
              <SkillIcon
                class='skillset-header-stat-icon'
                width='16'
                height='16'
              />
              {{@model.relatedSkills.length}}
              Skills
            </span>
            <span class='skillset-header-stat-item'>
              <ActivityIcon
                class='skillset-header-stat-icon'
                width='16'
                height='16'
              />
              Composite Guide
            </span>
          </div>
        </:headerRow>
        <:default>
          {{#if @model.instructions}}
            <article
              class='instructions-article'
              id='instructions'
              {{dividerActivation this.activateDivider}}
            >
              <@fields.instructionsWithIds />
            </article>
          {{else}}
            <EmptyStateContainer>
              <h3>Welcome to Your Skill Set</h3>
              <p>
                This skill set is currently empty. Get started by:
              </p>
              <ul class='skillset-empty-actions'>
                <li>
                  <EditIcon width='24' height='24' />
                  <span>
                    <strong>Add Front Matter</strong>
                    <p>Write an introduction or overview section</p>
                  </span>
                </li>
                <li>
                  <SkillIcon width='24' height='24' />
                  <span>
                    <strong>Add Related Skills</strong>
                    <p>Link existing skills to create a comprehensive guide</p>
                  </span>
                </li>
                <li>
                  <FileTextIcon width='24' height='24' />
                  <span>
                    <strong>Add Back Matter</strong>
                    <p>Include summary notes or reinforce key points</p>
                  </span>
                </li>
              </ul>
            </EmptyStateContainer>
          {{/if}}
      
          {{#if this.hasAppendix}}
            <AppendixSection>
              {{#if @model.relatedSkills.length}}
                <section class='commands-section' id='skills-footer'>
                  <h3 class='section-heading'>Related Skills</h3>
                  <@fields.relatedSkills
                    @format='embedded'
                    class='skills-cards'
                  />
                </section>
              {{/if}}
              {{#if @model.commands.length}}
                <section class='commands-section' id='available-commands'>
                  <h3 class='section-heading'>Available Commands</h3>
                  <@fields.commands
                    @format='embedded'
                    class='commands-container'
                  />
                </section>
              {{/if}}
            </AppendixSection>
          {{/if}}
        </:default>
      </DocLayout>
      
      <style scoped>
        .skillset-header-stats {
          display: flex;
          gap: var(--sp-4);
          margin-block: var(--sp-3);
          padding-top: var(--sp-3);
          border-top: 1px solid var(--db-border);
        }
        .skillset-header-stat-item {
          display: inline-flex;
          align-items: center;
          gap: calc(1.5 * var(--sp-1));
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--db-muted-foreground);
        }
        .skillset-header-stat-icon {
          width: 1rem;
          height: 1rem;
        }
      
        .skillset-empty-actions {
          list-style: none;
          padding: 0;
          margin-block: var(--sp-6);
          margin-inline: 0;
          text-align: start;
          display: inline-block;
          font-size: var(--boxel-font-size-sm);
        }
        .skillset-empty-actions :deep(p) {
          font-size: inherit;
        }
        .skillset-empty-actions :deep(li) {
          display: flex;
          align-items: flex-start;
          gap: var(--sp-3);
        }
        .skillset-empty-actions :deep(li + li) {
          margin-top: var(--sp-6);
        }
        .skillset-empty-actions :deep(li svg) {
          width: 1.5rem;
          height: 1.5rem;
          flex-shrink: 0;
          margin-top: calc(0.5 * var(--sp-1));
        }
        .skillset-empty-actions :deep(strong) {
          color: var(--db-foreground);
          font-weight: 600;
        }
      
        /* Clickable skill divider styling *\/
        .instructions-article :deep(.skill-divider-clickable) {
          cursor: pointer;
        }
        .instructions-article :deep(.skill-divider-clickable:hover) {
          transform: translateY(-2px);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        }
        .instructions-article :deep(.skill-divider) {
          margin: 4rem 0 2.5rem 0;
          padding: 2rem;
          background: var(--secondary);
          color: var(--secondary-foreground);
          border: 2px solid var(--secondary);
          border-radius: var(--boxel-border-radius-xl, 16px);
          scroll-margin-top: 2rem;
          display: flex;
          align-items: flex-start;
          gap: 1.5rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          transition: all 0.3s ease;
        }
        .instructions-article :deep(.divider-number) {
          flex-shrink: 0;
          width: 3rem;
          height: 3rem;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          font-weight: 800;
          background: var(--background);
          color: var(--foreground);
          border: 2px solid var(--border);
          border-radius: var(--boxel-border-radius-lg, 12px);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .instructions-article :deep(.divider-content) {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          min-width: 0;
        }
        .instructions-article :deep(.divider-topic) {
          font-size: 1.75rem;
          font-weight: 800;
          color: var(--secondary-foreground);
          letter-spacing: -0.03em;
          line-height: 1.1;
        }
        .instructions-article :deep(.divider-link) {
          font-size: 0.6875rem;
          color: var(--secondary-foreground);
          opacity: 0.7;
          text-decoration: none;
          font-family: var(--font-mono);
          transition: opacity 0.2s ease;
          word-break: break-all;
          line-height: 1.4;
        }
        .instructions-article :deep(.divider-link:hover) {
          opacity: 1;
        }
        .instructions-article :deep(.divider-context) {
          font-size: 0.6875rem;
          color: var(--secondary-foreground);
          opacity: 0.75;
          font-style: italic;
          margin-top: 0.25rem;
          line-height: 1.5;
          padding-left: 0;
        }
        /* ²²⁸ Divider inclusion mode badge - pill style *\/
        .instructions-article :deep(.divider-mode) {
          display: inline-block;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.375rem 0.75rem;
          border-radius: 999px;
          margin-top: 0.5rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .instructions-article :deep(.divider-mode-full) {
          /* ²²⁹ Full mode styling - pill *\/
          background: var(--primary);
          color: var(--primary-foreground);
        }
        .instructions-article :deep(.divider-mode-essential) {
          /* ²³⁰ Essential mode styling - pill *\/
          background: var(--accent);
          color: var(--accent-foreground);
        }
        .instructions-article :deep(.divider-mode-link-only) {
          /* ²³¹ Link only mode styling - pill *\/
          background: var(--muted); /* ²⁴³ Better contrast *\/
          color: var(--muted-foreground);
          border: 1px solid var(--border);
        }
      
        .skills-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: var(--sp-4);
        }
      
        @media (max-width: 640px) {
          .skills-cards {
            grid-template-columns: 1fr;
          }
        }
      </style>
      */
      {
        "id": "bDrwtqwE",
        "block": "[[[8,[32,0],[[24,0,\"skill-set-documentation\"],[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],[[\"@titleMeta\",\"@title\",\"@description\",\"@hideToc\"],[\"Skill Set Documentation\",[30,1,[\"cardTitle\"]],[30,1,[\"cardDescription\"]],[30,0,[\"isTocEmpty\"]]]],[[\"navbar\",\"headerRow\",\"default\"],[[[[1,\"\\n\"],[41,[30,1,[\"frontMatterToc\",\"length\"]],[[[1,\"      \"],[8,[32,1],[[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],[[\"@sectionTitle\",\"@navItems\"],[\"Intro\",[30,1,[\"frontMatterToc\"]]]],null],[1,\"\\n\"]],[]],null],[41,[30,1,[\"contentToc\",\"length\"]],[[[1,\"      \"],[8,[32,1],[[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],[[\"@sectionTitle\",\"@navItems\"],[\"Content\",[30,1,[\"contentToc\"]]]],null],[1,\"\\n\"]],[]],null],[41,[30,1,[\"backMatterToc\",\"length\"]],[[[1,\"      \"],[8,[32,1],[[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],[[\"@sectionTitle\",\"@navItems\"],[\"Summary\",[30,1,[\"backMatterToc\"]]]],null],[1,\"\\n\"]],[]],null],[41,[30,0,[\"hasAppendix\"]],[[[1,\"      \"],[8,[32,1],[[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],[[\"@sectionTitle\"],[\"Appendix\"]],[[\"default\"],[[[[1,\"\\n        \"],[10,\"ul\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n\"],[41,[30,1,[\"relatedSkills\",\"length\"]],[[[1,\"            \"],[10,\"li\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[10,3],[14,6,\"#skills-footer\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Related Skills\"],[13],[13],[1,\"\\n\"]],[]],null],[41,[30,1,[\"commands\",\"length\"]],[[[1,\"            \"],[10,\"li\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[10,3],[14,6,\"#available-commands\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Available Commands\"],[13],[13],[1,\"\\n\"]],[]],null],[1,\"        \"],[13],[1,\"\\n      \"]],[]]]]],[1,\"\\n\"]],[]],null],[1,\"  \"]],[]],[[[1,\"\\n    \"],[10,0],[14,0,\"skillset-header-stats\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n      \"],[10,1],[14,0,\"skillset-header-stat-item\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n        \"],[8,[32,2],[[24,0,\"skillset-header-stat-icon\"],[24,\"width\",\"16\"],[24,\"height\",\"16\"],[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],null,null],[1,\"\\n        \"],[1,[30,1,[\"relatedSkills\",\"length\"]]],[1,\"\\n        Skills\\n      \"],[13],[1,\"\\n      \"],[10,1],[14,0,\"skillset-header-stat-item\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n        \"],[8,[32,3],[[24,0,\"skillset-header-stat-icon\"],[24,\"width\",\"16\"],[24,\"height\",\"16\"],[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],null,null],[1,\"\\n        Composite Guide\\n      \"],[13],[1,\"\\n    \"],[13],[1,\"\\n  \"]],[]],[[[1,\"\\n\"],[41,[30,1,[\"instructions\"]],[[[1,\"      \"],[11,\"article\"],[24,0,\"instructions-article\"],[24,1,\"instructions\"],[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[4,[32,4],[[30,0,[\"activateDivider\"]]],null],[12],[1,\"\\n        \"],[8,[30,2,[\"instructionsWithIds\"]],[[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],null,null],[1,\"\\n      \"],[13],[1,\"\\n\"]],[]],[[[1,\"      \"],[8,[32,5],[[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],null,[[\"default\"],[[[[1,\"\\n        \"],[10,\"h3\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Welcome to Your Skill Set\"],[13],[1,\"\\n        \"],[10,2],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n          This skill set is currently empty. Get started by:\\n        \"],[13],[1,\"\\n        \"],[10,\"ul\"],[14,0,\"skillset-empty-actions\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n          \"],[10,\"li\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n            \"],[8,[32,6],[[24,\"width\",\"24\"],[24,\"height\",\"24\"],[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],null,null],[1,\"\\n            \"],[10,1],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n              \"],[10,\"strong\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Add Front Matter\"],[13],[1,\"\\n              \"],[10,2],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Write an introduction or overview section\"],[13],[1,\"\\n            \"],[13],[1,\"\\n          \"],[13],[1,\"\\n          \"],[10,\"li\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n            \"],[8,[32,2],[[24,\"width\",\"24\"],[24,\"height\",\"24\"],[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],null,null],[1,\"\\n            \"],[10,1],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n              \"],[10,\"strong\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Add Related Skills\"],[13],[1,\"\\n              \"],[10,2],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Link existing skills to create a comprehensive guide\"],[13],[1,\"\\n            \"],[13],[1,\"\\n          \"],[13],[1,\"\\n          \"],[10,\"li\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n            \"],[8,[32,7],[[24,\"width\",\"24\"],[24,\"height\",\"24\"],[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],null,null],[1,\"\\n            \"],[10,1],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n              \"],[10,\"strong\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Add Back Matter\"],[13],[1,\"\\n              \"],[10,2],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Include summary notes or reinforce key points\"],[13],[1,\"\\n            \"],[13],[1,\"\\n          \"],[13],[1,\"\\n        \"],[13],[1,\"\\n      \"]],[]]]]],[1,\"\\n\"]],[]]],[1,\"\\n\"],[41,[30,0,[\"hasAppendix\"]],[[[1,\"      \"],[8,[32,8],[[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],null,[[\"default\"],[[[[1,\"\\n\"],[41,[30,1,[\"relatedSkills\",\"length\"]],[[[1,\"          \"],[10,\"section\"],[14,0,\"commands-section\"],[14,1,\"skills-footer\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n            \"],[10,\"h3\"],[14,0,\"section-heading\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Related Skills\"],[13],[1,\"\\n            \"],[8,[30,2,[\"relatedSkills\"]],[[24,0,\"skills-cards\"],[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],[[\"@format\"],[\"embedded\"]],null],[1,\"\\n          \"],[13],[1,\"\\n\"]],[]],null],[41,[30,1,[\"commands\",\"length\"]],[[[1,\"          \"],[10,\"section\"],[14,0,\"commands-section\"],[14,1,\"available-commands\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"\\n            \"],[10,\"h3\"],[14,0,\"section-heading\"],[14,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"],[12],[1,\"Available Commands\"],[13],[1,\"\\n            \"],[8,[30,2,[\"commands\"]],[[24,0,\"commands-container\"],[24,\"data-scopedcss-a91bdd764a-256fef24f3\",\"\"]],[[\"@format\"],[\"embedded\"]],null],[1,\"\\n          \"],[13],[1,\"\\n\"]],[]],null],[1,\"      \"]],[]]]]],[1,\"\\n\"]],[]],null],[1,\"  \"]],[]]]]],[1,\"\\n\\n\"]],[\"@model\",\"@fields\"],[\"if\"]]",
        "moduleName": "packages/runtime-common/skill-set.gts",
        "scope": () => [DocLayout, TocSection, SkillIcon, ActivityIcon, dividerActivation, EmptyStateContainer, EditIcon, FileTextIcon, AppendixSection],
        "isStrictMode": true
      }), this);
    }
  };
  static embedded = class Embedded extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <div class='skill-set-embedded'>
        <div class='embedded-header'>
          <div class='skill-type-badge'>
            <SkillIcon class='badge-icon' />
            SKILL SET
          </div>
          <h3 class='embedded-title'>{{@model.cardTitle}}</h3>
        </div>
      
        {{#if @model.cardDescription}}
          <p class='embedded-description'>{{@model.cardDescription}}</p>
        {{/if}}
      
        {{#if (gt @model.relatedSkills.length 0)}}
          <div class='skills-summary'>
            <div class='summary-label'>Included Skills</div>
            <div class='skills-count'>{{@model.relatedSkills.length}}
              skills</div>
            <div class='skills-list'>
              {{#each @model.relatedSkills as |skillRef|}}
                <div class='skill-item'>
                  <span class='skill-bullet'>•</span>
                  <span class='skill-name'>{{if
                      skillRef.topicName
                      skillRef.topicName
                      'Untitled'
                    }}</span>
                  <span class='skill-mode'>{{if
                      skillRef.inclusionMode
                      skillRef.inclusionMode
                      'link-only'
                    }}</span>
                </div>
              {{/each}}
            </div>
          </div>
        {{else}}
          <div class='empty-skills'>
            <p>No related skills configured yet.</p>
          </div>
        {{/if}}
      </div>
      
      <style scoped>
        /* ¹⁹⁵ Professional embedded card styling *\/
        .skill-set-embedded {
          padding: 1.25rem;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--boxel-border-radius-lg);
          box-shadow: var(--shadow-sm);
        }
      
        .embedded-header {
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid var(--border);
        }
      
        .skill-type-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
          margin-bottom: 0.5rem;
        }
      
        .badge-icon {
          width: 0.875rem;
          height: 0.875rem;
        }
      
        .embedded-title {
          font-size: 1.125rem;
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
          line-height: 1.3;
        }
      
        .embedded-description {
          font-size: 0.875rem;
          color: var(--muted-foreground);
          line-height: 1.5;
          margin: 0 0 1rem 0;
        }
      
        .skills-summary {
          margin-top: 1rem;
        }
      
        .summary-label {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
          margin-bottom: 0.5rem;
        }
      
        .skills-count {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--primary);
          margin-bottom: 0.75rem;
        }
      
        .skills-list {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
      
        .skill-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          line-height: 1.4;
        }
      
        .skill-bullet {
          color: var(--primary);
          font-weight: 700;
          flex-shrink: 0;
        }
      
        .skill-name {
          flex: 1;
          color: var(--foreground);
          font-weight: 500;
        }
      
        .skill-mode {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.125rem 0.375rem;
          background: var(--muted);
          color: var(--muted-foreground);
          border-radius: var(--boxel-border-radius-sm);
          flex-shrink: 0;
        }
      
        .empty-skills {
          margin-top: 1rem;
          padding: 1rem;
          background: var(--muted);
          border-radius: var(--boxel-border-radius);
          text-align: center;
        }
      
        .empty-skills p {
          margin: 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          font-style: italic;
        }
      </style>
      */
      {
        "id": "l3QJIcfE",
        "block": "[[[10,0],[14,0,\"skill-set-embedded\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,\"\\n  \"],[10,0],[14,0,\"embedded-header\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,\"\\n    \"],[10,0],[14,0,\"skill-type-badge\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,\"\\n      \"],[8,[32,0],[[24,0,\"badge-icon\"],[24,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"]],null,null],[1,\"\\n      SKILL SET\\n    \"],[13],[1,\"\\n    \"],[10,\"h3\"],[14,0,\"embedded-title\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,[30,1,[\"cardTitle\"]]],[13],[1,\"\\n  \"],[13],[1,\"\\n\\n\"],[41,[30,1,[\"cardDescription\"]],[[[1,\"    \"],[10,2],[14,0,\"embedded-description\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,[30,1,[\"cardDescription\"]]],[13],[1,\"\\n\"]],[]],null],[1,\"\\n\"],[41,[28,[32,1],[[30,1,[\"relatedSkills\",\"length\"]],0],null],[[[1,\"    \"],[10,0],[14,0,\"skills-summary\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,\"\\n      \"],[10,0],[14,0,\"summary-label\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,\"Included Skills\"],[13],[1,\"\\n      \"],[10,0],[14,0,\"skills-count\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,[30,1,[\"relatedSkills\",\"length\"]]],[1,\"\\n        skills\"],[13],[1,\"\\n      \"],[10,0],[14,0,\"skills-list\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,\"\\n\"],[42,[28,[31,2],[[28,[31,2],[[30,1,[\"relatedSkills\"]]],null]],null],null,[[[1,\"          \"],[10,0],[14,0,\"skill-item\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,\"\\n            \"],[10,1],[14,0,\"skill-bullet\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,\"•\"],[13],[1,\"\\n            \"],[10,1],[14,0,\"skill-name\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,[52,[30,2,[\"topicName\"]],[30,2,[\"topicName\"]],\"Untitled\"]],[13],[1,\"\\n            \"],[10,1],[14,0,\"skill-mode\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,[52,[30,2,[\"inclusionMode\"]],[30,2,[\"inclusionMode\"]],\"link-only\"]],[13],[1,\"\\n          \"],[13],[1,\"\\n\"]],[2]],null],[1,\"      \"],[13],[1,\"\\n    \"],[13],[1,\"\\n\"]],[]],[[[1,\"    \"],[10,0],[14,0,\"empty-skills\"],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,\"\\n      \"],[10,2],[14,\"data-scopedcss-a91bdd764a-605d977f91\",\"\"],[12],[1,\"No related skills configured yet.\"],[13],[1,\"\\n    \"],[13],[1,\"\\n\"]],[]]],[13],[1,\"\\n\\n\"]],[\"@model\",\"skillRef\"],[\"if\",\"each\",\"-track-array\"]]",
        "moduleName": "packages/runtime-common/skill-set.gts",
        "scope": () => [SkillIcon, gt],
        "isStrictMode": true
      }), this);
    }
  };
  static fitted = class Fitted extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <div class='fitted-container'>
        {{! Badge format (≤150px width, <170px height) - Compact title display }}
        <div class='badge-format'>
          <div class='badge-title'>{{@model.cardTitle}}</div>
        </div>
      
        {{! Strip format (>150px width, <170px height) - Horizontal info bar }}
        <div class='strip-format'>
          <div class='strip-left'>
            <SkillIcon class='strip-icon' />
            <div class='strip-title'>{{@model.cardTitle}}</div>
          </div>
          <div class='strip-count'>{{@model.relatedSkills.length}} skills</div>
        </div>
      
        {{! Tile format (<400px width, ≥170px height) - Vertical card }}
        <div class='tile-format'>
          <div class='tile-header'>
            <SkillIcon class='tile-icon' />
            <div class='tile-badge'>SKILL SET</div>
          </div>
          <h4 class='tile-title'>{{@model.cardTitle}}</h4>
          <div class='tile-stats'>
            <span class='stat'>{{@model.relatedSkills.length}} skills</span>
          </div>
          {{#if @model.cardDescription}}
            <p class='tile-description'>{{@model.cardDescription}}</p>
          {{/if}}
        </div>
      
        {{! Card format (≥400px width, ≥170px height) - Full information }}
        <div class='card-format'>
          <div class='card-header'>
            <div class='card-meta'>
              <SkillIcon class='card-icon' />
              <span class='card-type'>SKILL SET</span>
            </div>
            <h4 class='card-title'>{{@model.cardTitle}}</h4>
          </div>
          {{#if @model.cardDescription}}
            <p class='card-description'>{{@model.cardDescription}}</p>
          {{/if}}
          <div class='card-footer'>
            <span class='footer-stat'>
              <SkillIcon class='footer-icon' />
              {{@model.relatedSkills.length}}
              skills
            </span>
          </div>
        </div>
      </div>
      
      <style scoped>
        /* Fitted container with size-based display *\/
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          background: var(--card);
          overflow: hidden;
        }
      
        /* ²⁰² Hide all formats by default *\/
        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
        }
      
        /* ²⁰³ Badge format - compact icon + count *\/
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.25rem;
            padding: 0.375rem;
          }
        }
      
        .badge-title {
          font-size: clamp(0.625rem, 4%, 0.75rem);
          font-weight: 700;
          color: var(--foreground);
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          line-height: 1.2;
        }
      
        /* Strip format - horizontal bar *\/
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.5rem 0.75rem;
            gap: 0.5rem;
          }
        }
      
        .strip-left {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
          flex: 1;
        }
      
        .strip-icon {
          width: 1.125rem;
          height: 1.125rem;
          color: var(--primary);
          flex-shrink: 0;
        }
      
        .strip-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      
        .strip-count {
          font-size: 0.6875rem;
          font-weight: 600;
          color: var(--muted-foreground);
          flex-shrink: 0;
        }
      
        /* Tile format - vertical card *\/
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
            padding: clamp(0.5rem, 3%, 0.875rem);
            gap: 0.5rem;
          }
        }
      
        .tile-header {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
      
        .tile-icon {
          width: 1rem;
          height: 1rem;
          color: var(--primary);
        }
      
        .tile-badge {
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
        }
      
        .tile-title {
          font-size: clamp(0.875rem, 4%, 1rem);
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
      
        .tile-stats {
          display: flex;
          gap: 0.5rem;
        }
      
        .stat {
          font-size: 0.6875rem;
          font-weight: 600;
          color: var(--primary);
        }
      
        .tile-description {
          font-size: 0.6875rem;
          color: var(--muted-foreground);
          line-height: 1.4;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
        }
      
        /* Card format - full layout *\/
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
            padding: clamp(0.75rem, 3%, 1rem);
            gap: 0.75rem;
          }
        }
      
        .card-header {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
      
        .card-meta {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
      
        .card-icon {
          width: 1.125rem;
          height: 1.125rem;
          color: var(--primary);
        }
      
        .card-type {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
        }
      
        .card-title {
          font-size: 1.125rem;
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
      
        .card-description {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          line-height: 1.5;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
      
        .card-footer {
          margin-top: auto;
          padding-top: 0.75rem;
          border-top: 1px solid var(--border);
        }
      
        .footer-stat {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-foreground);
        }
      
        .footer-icon {
          width: 0.875rem;
          height: 0.875rem;
        }
      </style>
      */
      {
        "id": "9HL9OqvD",
        "block": "[[[10,0],[14,0,\"fitted-container\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n\"],[1,\"  \"],[10,0],[14,0,\"badge-format\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n    \"],[10,0],[14,0,\"badge-title\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,[30,1,[\"cardTitle\"]]],[13],[1,\"\\n  \"],[13],[1,\"\\n\\n\"],[1,\"  \"],[10,0],[14,0,\"strip-format\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n    \"],[10,0],[14,0,\"strip-left\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n      \"],[8,[32,0],[[24,0,\"strip-icon\"],[24,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"]],null,null],[1,\"\\n      \"],[10,0],[14,0,\"strip-title\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,[30,1,[\"cardTitle\"]]],[13],[1,\"\\n    \"],[13],[1,\"\\n    \"],[10,0],[14,0,\"strip-count\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,[30,1,[\"relatedSkills\",\"length\"]]],[1,\" skills\"],[13],[1,\"\\n  \"],[13],[1,\"\\n\\n\"],[1,\"  \"],[10,0],[14,0,\"tile-format\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n    \"],[10,0],[14,0,\"tile-header\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n      \"],[8,[32,0],[[24,0,\"tile-icon\"],[24,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"]],null,null],[1,\"\\n      \"],[10,0],[14,0,\"tile-badge\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"SKILL SET\"],[13],[1,\"\\n    \"],[13],[1,\"\\n    \"],[10,\"h4\"],[14,0,\"tile-title\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,[30,1,[\"cardTitle\"]]],[13],[1,\"\\n    \"],[10,0],[14,0,\"tile-stats\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n      \"],[10,1],[14,0,\"stat\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,[30,1,[\"relatedSkills\",\"length\"]]],[1,\" skills\"],[13],[1,\"\\n    \"],[13],[1,\"\\n\"],[41,[30,1,[\"cardDescription\"]],[[[1,\"      \"],[10,2],[14,0,\"tile-description\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,[30,1,[\"cardDescription\"]]],[13],[1,\"\\n\"]],[]],null],[1,\"  \"],[13],[1,\"\\n\\n\"],[1,\"  \"],[10,0],[14,0,\"card-format\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n    \"],[10,0],[14,0,\"card-header\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n      \"],[10,0],[14,0,\"card-meta\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n        \"],[8,[32,0],[[24,0,\"card-icon\"],[24,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"]],null,null],[1,\"\\n        \"],[10,1],[14,0,\"card-type\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"SKILL SET\"],[13],[1,\"\\n      \"],[13],[1,\"\\n      \"],[10,\"h4\"],[14,0,\"card-title\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,[30,1,[\"cardTitle\"]]],[13],[1,\"\\n    \"],[13],[1,\"\\n\"],[41,[30,1,[\"cardDescription\"]],[[[1,\"      \"],[10,2],[14,0,\"card-description\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,[30,1,[\"cardDescription\"]]],[13],[1,\"\\n\"]],[]],null],[1,\"    \"],[10,0],[14,0,\"card-footer\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n      \"],[10,1],[14,0,\"footer-stat\"],[14,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"],[12],[1,\"\\n        \"],[8,[32,0],[[24,0,\"footer-icon\"],[24,\"data-scopedcss-a91bdd764a-b93057232b\",\"\"]],null,null],[1,\"\\n        \"],[1,[30,1,[\"relatedSkills\",\"length\"]]],[1,\"\\n        skills\\n      \"],[13],[1,\"\\n    \"],[13],[1,\"\\n  \"],[13],[1,\"\\n\"],[13],[1,\"\\n\\n\"]],[\"@model\"],[\"if\"]]",
        "moduleName": "packages/runtime-common/skill-set.gts",
        "scope": () => [SkillIcon],
        "isStrictMode": true
      }), this);
    }
  };
}