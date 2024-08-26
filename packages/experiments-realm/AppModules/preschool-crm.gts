import {
  CardDef,
  linksTo,
  linksToMany,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import DateTimeField from 'https://cardstack.com/base/datetime';
import NumberField from 'https://cardstack.com/base/number';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { AppCard } from '../app-card';

export class ToursCard extends CardDef {
  static displayName = 'Tours';

  @field tourID = contains(StringField);
  @field date = contains(DateField);
  @field time = contains(DateTimeField);
  @field parentsName = contains(StringField);
  @field contactInformation = contains(StringField);
  @field notes = contains(MarkdownField);

  @field parent = linksTo(() => ParentsCard);
}

export class StudentsCard extends CardDef {
  static displayName = 'Students';

  @field studentID = contains(StringField);
  @field name = contains(StringField);
  @field age = contains(NumberField);
  @field enrollmentDate = contains(DateField);
  @field parentsInformation = contains(StringField);
  @field allergiesMedicalNotes = contains(MarkdownField);
  @field attendanceRecords = containsMany(StringField); // Simplified for attendance records

  @field parents = linksToMany(() => ParentsCard);
  @field classes = linksToMany(() => ClassesCard);
}

export class ParentsCard extends CardDef {
  static displayName = 'Parents';

  @field parentID = contains(StringField);
  @field name = contains(StringField);
  @field contactInformation = contains(StringField);

  @field students = linksToMany(() => StudentsCard);
}

export class StaffCard extends CardDef {
  static displayName = 'Staff';

  @field staffID = contains(StringField);
  @field name = contains(StringField);
  @field role = contains(StringField);
  @field contactInformation = contains(StringField);
  @field schedule = contains(StringField); // Simplified for schedule

  @field classes = linksToMany(() => ClassesCard);
}

export class ClassesCard extends CardDef {
  static displayName = 'Classes';

  @field classID = contains(StringField);
  @field name = contains(StringField);
  @field instructor = linksTo(() => StaffCard);
  @field schedule = contains(StringField); // Simplified for schedule
  @field enrolledStudents = linksToMany(() => StudentsCard);
}

export class CommunicationsCard extends CardDef {
  static displayName = 'Communications';

  @field communicationID = contains(StringField);
  @field date = contains(DateField);
  @field type = contains(StringField); // e.g., Email/Phone/In-Person
  @field content = contains(MarkdownField);
  @field followUpDate = contains(DateField);

  @field parent = linksTo(() => ParentsCard);
  @field staff = linksTo(() => StaffCard); // Optional, for communication with staff
}

export class PreschoolCRMApp extends AppCard {
  static displayName = 'Preschool CRM';

  @field overview = contains(MarkdownField);
  @field tours = linksToMany(ToursCard);
  @field students = linksToMany(StudentsCard);
  @field parents = linksToMany(ParentsCard);
  @field staff = linksToMany(StaffCard);
  @field classes = linksToMany(ClassesCard);
  @field communications = linksToMany(CommunicationsCard);
}
