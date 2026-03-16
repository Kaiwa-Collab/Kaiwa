import { createStackNavigator } from "@react-navigation/stack";
import React from "react";
import Search from "./screen/Search";
import Notifications from "./screen/Notifications";
import ProjectDetailsModal from "../service/ProjectDetailsModal";

const Stack = createStackNavigator();


    export default function searchStack() {
     return (
        <Stack.Navigator
screenOptions={{
  headerShown: false
}}
>
    <Stack.Screen name="Search"
     component={Search}
     options={({route})=>({


     })} 
     />
    <Stack.Screen name="Notifications" component={Notifications} />
    <Stack.Screen name="ProjectDetails" component={ProjectDetailsModal} />
</Stack.Navigator>
    );
}
