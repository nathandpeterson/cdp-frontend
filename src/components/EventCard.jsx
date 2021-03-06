import React from "react";
import { Link } from "react-router-dom";
import { Card } from "semantic-ui-react";
import styled from "@emotion/styled";

const StyledCard = styled(Card)({
  boxShadow: "none !important"
});

const StyledCardContent = styled(Card.Content)({
  padding: "0 !important"
});

const EventCard = ({ name, date, description, link }) => (
  <StyledCard fluid>
    <StyledCardContent>
      <Card.Header>
        <Link to={link}>{name}</Link>
      </Card.Header>
      <Card.Meta>{date}</Card.Meta>
      <Card.Description>{description}</Card.Description>
    </StyledCardContent>
  </StyledCard>
);

export default EventCard;
